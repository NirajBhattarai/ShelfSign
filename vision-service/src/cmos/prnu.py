"""
Classical PRNU (Photo Response Non-Uniformity) sensor fingerprinting.

Complements the coordinate-based pixel-stability PUF in puf_coords.py (which
derives a *signing key*) with the standard forensic technique for proving an
image came from one specific physical sensor: wavelet-domain denoising to
isolate the sensor's fixed noise pattern, then correlating a fresh capture's
residual against a camera's enrolled reference pattern.

Method (Lukas/Fridrich/Goljan; denoising per Mihcak et al., as implemented
in the reference Binghamton PRNU toolbox):
  1. 4-level Daubechies-8 wavelet decomposition of the grayscale capture.
  2. Per-subband Wiener shrinkage using a robust noise-sigma estimate (MAD
     of the finest diagonal subband) and a local variance estimate taken as
     the MINIMUM across several window sizes (3/5/7/9) -- this is what
     keeps genuine high-frequency scene detail from being shrunk away along
     with the noise.
  3. residual = original - denoised. Row/column means are then removed to
     null out JPEG blocking and rolling-shutter banding (the "linear
     pattern" the PRNU literature always strips before correlating).
  4. A camera's fingerprint is the average residual across its enrollment
     burst -- more frames means less scene content and more fixed sensor
     pattern survives the average.
  5. A fresh capture is verified against that fingerprint via normalized
     cross-correlation (Pearson r) over the two residuals. Camera is
     static and captures are the same resolution/framing, so no
     PCE/circular-search alignment step is needed -- direct NCC is the
     right statistic for this fixed-camera verification case (as opposed
     to a "which camera in a database took this image" search).

This score is informational by default -- see SHELFSIGN_ENFORCE_PRNU in
challenge_pipeline.py for why it doesn't hard-gate attestation out of the
box.
"""
from __future__ import annotations

import os

import numpy as np
import pywt

WAVELET = "db8"
DECOMP_LEVELS = 4
_WINDOW_SIZES = (3, 5, 7, 9)

# NCC threshold for "this residual matches the enrolled fingerprint". PRNU
# correlation values are small even for genuine matches (real toolboxes
# lean on PCE for this reason); this default is a conservative starting
# point, not a calibrated-per-hardware value -- see SHELFSIGN_ENFORCE_PRNU.
PRNU_MATCH_THRESHOLD = float(os.environ.get("PRNU_MATCH_THRESHOLD", "0.01"))


def _box_filter(arr: np.ndarray, k: int) -> np.ndarray:
    """k x k box average via a padded 2D cumulative sum -- O(HW) per call,
    no scipy dependency (mirrors puf_coords.py's numpy-only fallback)."""
    pad = k // 2
    padded = np.pad(arr, pad, mode="reflect")
    csum = np.cumsum(np.cumsum(padded, axis=0), axis=1)
    csum = np.pad(csum, ((1, 0), (1, 0)), mode="constant")
    h, w = arr.shape
    total = (
        csum[k:k + h, k:k + w]
        - csum[0:h, k:k + w]
        - csum[k:k + h, 0:w]
        + csum[0:h, 0:w]
    )
    return total / (k * k)


def _local_variance(band: np.ndarray, sigma_sq: float) -> np.ndarray:
    """Minimum-across-window-sizes local variance estimate (Mihcak et al.):
    taking the min avoids over-shrinking edges/texture that a single fixed
    window size would blur into the noise estimate."""
    sq = band ** 2
    estimates = np.stack(
        [np.maximum(_box_filter(sq, k) - sigma_sq, 0.0) for k in _WINDOW_SIZES],
        axis=0,
    )
    return estimates.min(axis=0)


def _wiener_shrink(band: np.ndarray, sigma_sq: float) -> np.ndarray:
    local_var = _local_variance(band, sigma_sq)
    gain = local_var / (local_var + sigma_sq)
    return band * gain


def wavelet_denoise(gray: np.ndarray) -> np.ndarray:
    """Mihcak-style wavelet denoising: returns the *signal* estimate that
    PRNU extraction subtracts from the original to isolate sensor noise."""
    coeffs = pywt.wavedec2(gray, WAVELET, level=DECOMP_LEVELS, mode="periodization")
    cA, *details = coeffs

    # Robust noise-sigma estimate from the finest-level diagonal subband
    # (Donoho's median-absolute-deviation universal threshold basis).
    finest_hh = details[-1][2]
    sigma = np.median(np.abs(finest_hh)) / 0.6745
    sigma_sq = float(sigma ** 2)

    shrunk = [tuple(_wiener_shrink(b, sigma_sq) for b in level) for level in details]
    recon = pywt.waverec2([cA, *shrunk], WAVELET, mode="periodization")
    return recon[: gray.shape[0], : gray.shape[1]]


def noise_residual(gray: np.ndarray) -> np.ndarray:
    """Sensor noise residual: original minus its wavelet-domain denoised
    estimate, with row/column means removed (kills JPEG block + rolling-
    shutter banding, which would otherwise dominate the correlation)."""
    denoised = wavelet_denoise(gray)
    residual = gray - denoised
    residual = residual - residual.mean(axis=0, keepdims=True)
    residual = residual - residual.mean(axis=1, keepdims=True)
    return residual.astype(np.float32)


def estimate_fingerprint(captures: list[np.ndarray]) -> np.ndarray:
    """Average noise residual across an enrollment burst -- the classical
    PRNU reference pattern for one physical sensor."""
    if len(captures) < 3:
        raise ValueError("estimate_fingerprint needs at least 3 captures")
    residuals = np.stack([noise_residual(c) for c in captures], axis=0)
    return residuals.mean(axis=0).astype(np.float32)


def correlate(
    residual: np.ndarray,
    fingerprint: np.ndarray,
    exclude_box: tuple[int, int, int, int] | None = None,
) -> float:
    """Normalized cross-correlation (Pearson r) between a fresh capture's
    noise residual and the camera's enrolled PRNU fingerprint.

    `exclude_box` is (x0, y0, x1, y1) pixels to drop from both arrays before
    correlating -- used to mask out the OSD nonce overlay corner, which
    burns different dynamic text into every capture and would otherwise
    inject non-sensor noise into the comparison.
    """
    if residual.shape != fingerprint.shape:
        raise ValueError(
            f"PRNU shape mismatch: residual {residual.shape} vs fingerprint {fingerprint.shape}"
        )
    a, b = residual, fingerprint
    if exclude_box is not None:
        x0, y0, x1, y1 = exclude_box
        mask = np.ones(a.shape, dtype=bool)
        mask[y0:y1, x0:x1] = False
        a, b = a[mask], b[mask]

    a = a.ravel() - a.mean()
    b = b.ravel() - b.mean()
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom < 1e-9:
        return 0.0
    return float(np.dot(a, b) / denom)
