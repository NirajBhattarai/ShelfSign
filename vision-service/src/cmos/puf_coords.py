"""
Coordinate-selection and bit-extraction logic shared by enroll and
regenerate. Ported verbatim from siliconwitness's gateway/puf/coords.py --
enroll and regenerate MUST reproduce the exact same bit positions and
extraction rule or nothing will ever match, so this stays one shared module.
"""
from __future__ import annotations

import numpy as np

NEIGHBORHOOD = 9  # 9x9 local median window
BORDER = NEIGHBORHOOD // 2


def local_median_map_numpy(arr: np.ndarray, k: int = NEIGHBORHOOD) -> np.ndarray:
    """Pure-numpy k x k median filter (no scipy dependency)."""
    pad = k // 2
    padded = np.pad(arr, pad, mode="reflect")
    h, w = arr.shape
    windows = np.empty((k * k, h, w), dtype=np.float32)
    idx = 0
    for dy in range(k):
        for dx in range(k):
            windows[idx] = padded[dy:dy + h, dx:dx + w]
            idx += 1
    return np.median(windows, axis=0)


def get_local_median(arr: np.ndarray, k: int = NEIGHBORHOOD) -> np.ndarray:
    try:
        from scipy.ndimage import median_filter
        return median_filter(arr, size=k, mode="reflect")
    except ImportError:
        return local_median_map_numpy(arr, k)


def select_top_coords(
    mean_arr: np.ndarray,
    top_k: int,
    border: int = BORDER,
    exclude_box: tuple[int, int, int, int] | None = None,
) -> list[tuple[int, int]]:
    """Rank pixels by local contrast margin against their 9x9 neighbourhood
    median, return the top_k (row, col) coordinates.

    `exclude_box` is (x0, y0, x1, y1) in image coordinates — typically the
    OSD overlay crop. Bits chosen inside that region flip whenever the
    challenge nonce text changes, which breaks BCH even on the same sensor.
    """
    med = get_local_median(mean_arr)
    margin = np.abs(mean_arr - med)
    margin[:border, :] = -1
    margin[-border:, :] = -1
    margin[:, :border] = -1
    margin[:, -border:] = -1
    if exclude_box is not None:
        x0, y0, x1, y1 = exclude_box
        h, w = margin.shape
        y0c, y1c = max(0, y0), min(h, y1)
        x0c, x1c = max(0, x0), min(w, x1)
        if y1c > y0c and x1c > x0c:
            margin[y0c:y1c, x0c:x1c] = -1
    flat_idx = np.argsort(margin.ravel())[::-1][:top_k]
    coords = [tuple(int(x) for x in np.unravel_index(i, margin.shape)) for i in flat_idx]
    return coords


def local_median_at_coords(arr: np.ndarray, coords: list[tuple[int, int]], k: int = NEIGHBORHOOD) -> np.ndarray:
    pad = k // 2
    padded = np.pad(arr, pad, mode="reflect")
    meds = np.empty(len(coords), dtype=np.float32)
    for i, (r, c) in enumerate(coords):
        meds[i] = np.median(padded[r:r + k, c:c + k])
    return meds


class CoordinatesOutOfBounds(ValueError):
    """Enrolled coordinates don't fit this capture's resolution -- e.g. a
    camera swap to a device with a smaller sensor/frame size than the one
    enrolled. This is fraud-relevant, not a crash: callers should treat it
    as an immediate PUF mismatch, not let it propagate as a 500/502."""


def extract_bits(arr: np.ndarray, coords: list[tuple[int, int]]) -> np.ndarray:
    """bit=1 if pixel exceeds ITS OWN capture's local 9x9 median at that
    coordinate, else 0. Independent per-capture -- the only thing available
    at regeneration time (a single fresh reading, no averaging)."""
    h, w = arr.shape
    for r, c in coords:
        if r < 0 or r >= h or c < 0 or c >= w:
            raise CoordinatesOutOfBounds(
                f"coordinate ({r}, {c}) is out of bounds for capture shape {arr.shape}"
            )
    meds = local_median_at_coords(arr, coords)
    vals = np.array([arr[r, c] for r, c in coords], dtype=np.float32)
    return (vals > meds).astype(np.uint8)


# Must match challenge_pipeline.OSD_CROP — nonce glyphs are burned here.
OSD_EXCLUDE_BOX = (0, 0, 280, 220)


def select_stable_coords_from_burst(captures: list[np.ndarray], candidate_pool: int = 4096,
                                     n_final: int = 256) -> tuple[list[tuple[int, int]], np.ndarray, np.ndarray]:
    """Select the n_final MOST EMPIRICALLY STABLE bit coordinates out of a
    burst of enrollment captures, rather than trusting local-contrast margin
    alone as a stability proxy (siliconwitness's BER_REPORT_V2.md found the
    margin-only proxy overstated real bit-flip rate by ~3-4x).

    Method: (1) rank `candidate_pool` pixels by contrast margin on the
    averaged burst image; (2) extract each candidate's bit on EVERY capture;
    (3) take the per-coordinate MAJORITY VOTE across the burst as the
    reference bit; (4) rank by empirical flip rate against that vote and
    keep the n_final most stable.

    Returns (coords, reference_bits, flip_counts).
    """
    if len(captures) < 3:
        raise ValueError("select_stable_coords_from_burst needs at least 3 captures "
                          "for the majority vote to be meaningful")

    mean_arr = np.mean(np.stack(captures, axis=0), axis=0)
    candidates = select_top_coords(
        mean_arr, candidate_pool, exclude_box=OSD_EXCLUDE_BOX
    )

    bit_matrix = np.zeros((len(captures), len(candidates)), dtype=np.uint8)
    for i, arr in enumerate(captures):
        meds = local_median_at_coords(arr, candidates)
        vals = np.array([arr[r, c] for r, c in candidates], dtype=np.float32)
        bit_matrix[i] = (vals > meds).astype(np.uint8)

    majority = (bit_matrix.mean(axis=0) >= 0.5).astype(np.uint8)
    flips = (bit_matrix != majority[None, :]).sum(axis=0)
    order = np.argsort(flips)  # ascending: most stable first

    best_idx = order[:n_final]
    best_coords = [candidates[i] for i in best_idx]
    reference_bits = majority[best_idx]
    flip_counts = flips[best_idx]
    return best_coords, reference_bits, flip_counts


def bits_to_bytes(bits: np.ndarray) -> bytes:
    """Pack a 0/1 uint8 array into bytes, MSB-first, zero-padded on the
    right if len(bits) is not a multiple of 8."""
    n = len(bits)
    pad = (-n) % 8
    if pad:
        bits = np.concatenate([bits, np.zeros(pad, dtype=np.uint8)])
    packed = np.packbits(bits)
    return packed.tobytes()
