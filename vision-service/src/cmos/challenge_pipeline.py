"""
SiliconWitness challenge responder, multi-tenant.

Adapted from /Users/niraj/Desktop/siliconwitness/gateway/challenge.py so
ShelfSign can drive the same physical challenge-response (OSD nonce + IR +
brightness + PUF key regeneration + secp256k1 signature) against any camera
whose credentials + enrollment record are supplied by the backend — instead
of siliconwitness's single global .env / enrollment.json.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Optional

import numpy as np
from eth_utils import keccak

from .capture import capture_snapshot, mean_luminance, saturation_variance
from .device_authenticity import (
    SyntheticDeviceError,
    assert_physical_device,
    osd_region_changed,
)
from .enroll_pipeline import EnrollmentRecord, DEFAULT_SETTLE_S
from .isapi_client import ISAPIClient
from .isapi_controls import set_color, set_ir_brightness, set_ircut_mode, set_osd_text
from .prnu import PRNU_MATCH_THRESHOLD, correlate as prnu_correlate, noise_residual
from .puf_coords import CoordinatesOutOfBounds, bits_to_bytes, extract_bits
from .puf_fuzzy_extractor import BCHParams, regenerate as fx_regenerate
from .puf_keys import sign_and_zero

SETTLE_S = {
    "osd": 2.0,
    "ircut": 8.0,
    "ir_brightness": 5.0,
    "brightness": 2.0,
}
# Extra AE settle after disabling OSD / confirming night — enroll uses
# DEFAULT_SETTLE_S after the same actuator sequence.
PUF_BIT_SETTLE_S = DEFAULT_SETTLE_S
OSD_CROP = (0, 0, 260, 190)
OSD_FUZZY_MATCH_THRESHOLD = 0.5
# Majority-vote fresh captures before BCH decode — cuts single-frame noise
# that otherwise exceeds correction capacity on live Hikvision JPEG.
CHALLENGE_BIT_SAMPLES = 3
CHALLENGE_BIT_INTERVAL_S = 0.35


_NIGHT_MODE_SAT_THRESHOLD = (
    5.0  # saturation variance below which we consider night mode confirmed
)
_NIGHT_MODE_CONFIRM_POLL_S = (
    20.0  # max time to poll (matches enroll_pipeline's confirm_poll_s default)
)
_NIGHT_MODE_CONFIRM_INTERVAL_S = 1.0

# PRNU correlation is computed and returned on every challenge, but does NOT
# gate `match` by default -- PRNU_MATCH_THRESHOLD is a literature-typical
# starting point, not a value calibrated against this specific sensor's real
# JPEG compression, so treating it as a hard fraud gate out of the box risks
# false-positive fraud flags (and, downstream, wrongly slashing a real
# camera's escrow bond) on genuine hardware. Set SHELFSIGN_ENFORCE_PRNU=1
# once you've verified genuine-vs-impostor score separation on the actual
# enrolled camera.
ENFORCE_PRNU = os.environ.get("SHELFSIGN_ENFORCE_PRNU") in ("1", "true")


def _confirm_night_mode(
    client: ISAPIClient, confirm_poll_s: float = _NIGHT_MODE_CONFIRM_POLL_S
) -> None:
    """Poll until saturation_variance drops below threshold (night/mono mode
    collapses chroma to ~0) or the timeout elapses. Mirrors enroll_pipeline's
    _force_night_mode confirmation loop — without this, the challenge capture
    can land in day mode if the IRCUT mechanical switch is still in transit,
    causing bit-flip rates that exceed BCH correction capacity and triggering
    'PUF key regeneration failed'."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < confirm_poll_s:
        cap = capture_snapshot(client)
        if saturation_variance(cap) < _NIGHT_MODE_SAT_THRESHOLD:
            return
        time.sleep(_NIGHT_MODE_CONFIRM_INTERVAL_S)
    # Timeout — proceed anyway; if the camera can't settle, regen will either
    # succeed (camera was already in night mode) or fail with a clear BCH error.


def apply_required_state(client: ISAPIClient, required_state: dict) -> float:
    wait_s = 0.0

    osd_nonce = required_state.get("osdNonce")
    if osd_nonce is not None:
        set_osd_text(client, osd_nonce, enabled=True, position_x=0, position_y=576)
        wait_s = max(wait_s, SETTLE_S["osd"])

    ir_level = required_state.get("irLevel")
    if ir_level is not None:
        set_ir_brightness(client, int(ir_level))
        wait_s = max(wait_s, SETTLE_S["ir_brightness"])

    brightness = required_state.get("brightness")
    if brightness is not None:
        set_color(client, brightness=int(brightness))
        wait_s = max(wait_s, SETTLE_S["brightness"])

    color_mode = required_state.get("colorMode")
    if color_mode is not None:
        mode = "night" if color_mode == "mono" else "day"
        set_ircut_mode(client, mode)
        wait_s = max(wait_s, SETTLE_S["ircut"])

    return wait_s


def apply_puf_actuator_state(
    client: ISAPIClient,
    *,
    ir_level: int,
    brightness: int,
    color_mode: str,
) -> float:
    """IR / brightness / night only — OSD stays off for stable PUF bits."""
    wait_s = 0.0
    set_ir_brightness(client, int(ir_level))
    wait_s = max(wait_s, SETTLE_S["ir_brightness"])
    set_color(client, brightness=int(brightness))
    wait_s = max(wait_s, SETTLE_S["brightness"])
    mode = "night" if color_mode == "mono" else "day"
    from .isapi_controls import get_ircut_mode

    if get_ircut_mode(client) != mode:
        set_ircut_mode(client, mode)
        wait_s = max(wait_s, SETTLE_S["ircut"])
    else:
        # Already in target mode — short settle only.
        wait_s = max(wait_s, SETTLE_S["brightness"])
    return wait_s


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1]


def similarity(a: str, b: str) -> float:
    a, b = a.strip().lower(), b.strip().lower()
    if not a and not b:
        return 1.0
    dist = _levenshtein(a, b)
    return 1.0 - dist / max(len(a), len(b), 1)


def ocr_osd_region(cap, box=OSD_CROP) -> list[str]:
    try:
        import pytesseract
        from PIL import ImageOps
    except ImportError:
        return []

    try:
        pytesseract.get_tesseract_version()
    except Exception:
        # Binary missing — treat OCR as unavailable (hackathon / bare install).
        return []

    x0, y0, x1, y1 = box
    base = cap.image.crop((x0, y0, x1, y1)).convert("L")
    base = base.resize((base.width * 4, base.height * 4))

    lines: list[str] = []
    seen = set()
    for variant in (
        ImageOps.autocontrast(base, cutoff=1),
        ImageOps.autocontrast(ImageOps.invert(base), cutoff=1),
    ):
        try:
            raw = pytesseract.image_to_string(variant, config="--psm 6")
        except Exception:
            continue
        for line in raw.splitlines():
            line = line.strip()
            if line and line not in seen:
                seen.add(line)
                lines.append(line)
    return lines


def ocr_osd_nonce(cap, expected: Optional[str] = None, box=OSD_CROP) -> str:
    lines = ocr_osd_region(cap, box)
    if not lines:
        return ""
    if expected:
        return max(lines, key=lambda l: similarity(l, expected))
    return lines[-1]


def canonical_bytes_for_signing(attestation_without_signature: dict) -> bytes:
    return json.dumps(
        attestation_without_signature, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def respond_to_challenge(
    host: str,
    username: str,
    password: str,
    record: EnrollmentRecord,
    nonce: str,
    *,
    ir_level: int = 100,
    brightness: int = 50,
    color_mode: str = "mono",
    settle_override_s: Optional[float] = None,
    sequence: int = 0,
    prev_hash: str = "0x0",
) -> dict:
    """Drive camera to challenge state, regenerate PUF key, sign attestation.

    Returns a dict with match/signature/imageHash/measured/verdict suitable
    for ShelfSign's backend attest route.
    """
    challenge_id = "0x" + hashlib.sha256(nonce.encode()).hexdigest()[:32]

    coords = [tuple(c) for c in record.coordinates]
    helper = bytes.fromhex(record.helper_hex)
    bp = record.bch_params
    params = BCHParams(
        m=bp["m"],
        t=bp["t"],
        n=bp["n"],
        ecc_bits=0,
        ecc_bytes=0,
        data_bytes=bp["data_bytes"],
        buffer_bytes=bp["buffer_bytes"],
        assumed_worst_flips=bp["assumed_worst_flips"],
        achieved_margin=bp["achieved_margin"],
    )

    client = ISAPIClient(host=host, user=username, password=password)

    from .camera_gate import camera_snapshot_lock

    with camera_snapshot_lock(host=host, timeout_s=120.0):
        # Fail closed on known stubs even if they were enrolled before this
        # check existed (self-consistent PUF replay is not a real sensor).
        try:
            assert_physical_device(client)
        except SyntheticDeviceError as e:
            return {
                "match": False,
                "score": 0.0,
                "correctedBitErrors": None,
                "signature": None,
                "signingError": str(e),
                "imageHash": hashlib.sha256(
                    f"synthetic:{host}:{nonce}".encode()
                ).hexdigest(),
                "cmosAccount": record.address,
                "attestation": None,
                "osdMatch": False,
                "osdDecoded": "",
                "prnuScore": None,
                "prnuMatch": False,
                "prnuAvailable": record.prnu_fingerprint is not None,
                "frameBytes": None,
            }

        # --- Phase 1: PUF bits with OSD OFF (must match enroll_pipeline) ---
        # Burning overlay text before bit extraction shifts AE / JPEG enough
        # to flip near-threshold coords; BCH then miscorrects (low nerr, wrong
        # address) → puf_enrollment_stale even on a fresh enrollment.
        wait_s = apply_puf_actuator_state(
            client,
            ir_level=ir_level,
            brightness=brightness,
            color_mode=color_mode,
        )
        if settle_override_s is not None:
            wait_s = settle_override_s
        else:
            wait_s = max(wait_s, PUF_BIT_SETTLE_S)
        time.sleep(wait_s)

        if color_mode == "mono":
            _confirm_night_mode(client)

        set_osd_text(client, "", enabled=False)
        time.sleep(SETTLE_S["osd"])

        bit_rows = []
        puf_caps = []
        coords_out_of_bounds = False
        try:
            for i in range(CHALLENGE_BIT_SAMPLES):
                c = capture_snapshot(client)
                puf_caps.append(c)
                bit_rows.append(extract_bits(c.array, coords))
                if i < CHALLENGE_BIT_SAMPLES - 1:
                    time.sleep(CHALLENGE_BIT_INTERVAL_S)
        except CoordinatesOutOfBounds:
            coords_out_of_bounds = True

        if not puf_caps:
            return {
                "match": False,
                "score": 0.0,
                "correctedBitErrors": None,
                "signature": None,
                "signingError": "challenge_capture_failed",
                "imageHash": "",
                "cmosAccount": record.address,
                "attestation": None,
                "osdMatch": False,
                "osdDecoded": "",
                "prnuScore": None,
                "prnuMatch": False,
                "prnuAvailable": record.prnu_fingerprint is not None,
                "frameBytes": None,
            }

        puf_cap = puf_caps[-1]
        if coords_out_of_bounds:
            bits = None
        else:
            stacked = np.stack(bit_rows, axis=0)
            bits = (stacked.sum(axis=0) >= (CHALLENGE_BIT_SAMPLES // 2 + 1)).astype(
                np.uint8
            )

        # PRNU against the OSD-off PUF frame (enrollment fingerprint is also
        # estimated with OSD disabled).
        prnu_score: Optional[float] = None
        prnu_available = record.prnu_fingerprint is not None
        prnu_match = True
        if prnu_available:
            try:
                residual = noise_residual(puf_cap.array)
                prnu_score = prnu_correlate(
                    residual, record.prnu_fingerprint, exclude_box=OSD_CROP
                )
                prnu_match = prnu_score >= PRNU_MATCH_THRESHOLD
            except ValueError:
                prnu_match = False

        # --- Phase 2: OSD nonce burn-in + liveness (separate from PUF bits) ---
        set_osd_text(client, nonce, enabled=True, position_x=0, position_y=576)
        time.sleep(SETTLE_S["osd"])
        osd_probe_before = capture_snapshot(client)
        probe_alt = "zzzzzz" if nonce.lower() != "zzzzzz" else "yyyyyy"
        set_osd_text(client, probe_alt, enabled=True, position_x=0, position_y=576)
        time.sleep(SETTLE_S["osd"])
        osd_probe_mid = capture_snapshot(client)
        set_osd_text(client, nonce, enabled=True, position_x=0, position_y=576)
        time.sleep(SETTLE_S["osd"])
        cap = capture_snapshot(client)

        osd_burned_in = osd_region_changed(
            osd_probe_before.array, osd_probe_mid.array, OSD_CROP
        ) or osd_region_changed(osd_probe_mid.array, cap.array, OSD_CROP)

        mean_lum = mean_luminance(cap)
        sat_var = saturation_variance(cap)
        osd_decoded = ocr_osd_nonce(cap, expected=nonce)
        osd_similarity = similarity(osd_decoded, nonce) if nonce else 0.0

        # OSD must prove the nonce was burned into the capture pipeline.
        # Soft-passing when OCR is empty let fixture stubs (no overlay in
        # JPEG) pass CMOS challenge after self-enrollment.
        if _tesseract_available():
            if osd_decoded:
                osd_match = osd_similarity >= OSD_FUZZY_MATCH_THRESHOLD
            else:
                osd_match = False
        else:
            # No OCR binary: require the OSD crop to change when overlay text
            # changes. Real cameras re-encode with new glyphs; stubs that only
            # store OSD in RAM leave the crop unchanged.
            osd_match = bool(osd_burned_in)

        regen_failed = False
        corrected_errors = None
        fx_result = None
        if coords_out_of_bounds:
            regen_failed = True
        else:
            measured_bytes = bits_to_bytes(bits)
            try:
                fx_result = fx_regenerate(
                    measured_bytes,
                    helper,
                    params,
                    with_crc=bool(bp.get("helper_crc")),
                )
                corrected_errors = fx_result.corrected_bit_errors
            except RuntimeError:
                regen_failed = True

        address_match = False
        signature = None
        signing_error = "camera_resolution_mismatch" if coords_out_of_bounds else None

        body = {
            "cameraId": record.address,
            "sequence": sequence,
            "prevHash": prev_hash,
            "challengeId": challenge_id,
            "challengeResponse": {
                "osdNonce": nonce,
                "irLevel": ir_level,
                "brightness": brightness,
                "colorMode": color_mode,
            },
            "measured": {
                "meanLuminance": round(mean_lum, 2),
                "saturationVariance": round(sat_var, 2),
                "osdDecoded": osd_decoded,
                "osdSimilarity": round(osd_similarity, 3),
                "correctedBitErrors": corrected_errors,
                "prnuScore": round(prnu_score, 6) if prnu_score is not None else None,
                "prnuAvailable": prnu_available,
            },
            "verdict": {
                "claim": (
                    "clear"
                    if osd_match
                    and not regen_failed
                    and (prnu_match or not ENFORCE_PRNU)
                    else "mismatch"
                ),
                "confidence": (
                    round(min(0.95, 0.5 + 0.45 * max(osd_similarity, 0.5)), 2)
                    if not regen_failed
                    else 0.0
                ),
            },
            "enclaveAttestation": "0x",
            "timestamp": int(cap.timestamp),
        }

        if regen_failed or fx_result is None:
            if coords_out_of_bounds:
                signing_error = signing_error or "camera_resolution_mismatch"
            elif prnu_available and prnu_match:
                # Same sensor (PRNU) but helper can't correct — scene/IR drift
                # since enroll. Backend should re-enroll, not fraud-flag.
                signing_error = "puf_enrollment_stale"
            else:
                signing_error = signing_error or "PUF key regeneration failed"
            body["signature"] = None
            body["signingError"] = signing_error
        else:
            from .puf_keys import derive_address, derive_private_key

            # Address check uses a copy of key material so sign_and_zero still
            # has the original for signing.
            pk = derive_private_key(bytearray(fx_result.key))
            regen_address = derive_address(pk)
            del pk
            address_match = regen_address.lower() == record.address.lower()

            if address_match:
                message_hash = keccak(canonical_bytes_for_signing(body))
                signature = sign_and_zero(fx_result.key, message_hash)
                body["signature"] = signature
            else:
                # BCH reported success but wrong codeword (miscorrection when
                # true flips ≫ t). Same sensor via PRNU → treat as stale enroll.
                body["signature"] = None
                if prnu_available and prnu_match:
                    signing_error = "puf_enrollment_stale"
                else:
                    signing_error = "regenerated_address_mismatch"
                body["signingError"] = signing_error

        image_hash = hashlib.sha256(cap.raw_bytes).hexdigest()
        frame_bytes = cap.raw_bytes

    prnu_gate = prnu_match or not ENFORCE_PRNU
    return {
        "match": bool(address_match and osd_match and signature and prnu_gate),
        "score": 1.0 if address_match else 0.0,
        "correctedBitErrors": corrected_errors,
        "signature": signature,
        "signingError": signing_error,
        "imageHash": image_hash,
        "cmosAccount": record.address,
        "attestation": body,
        "osdMatch": osd_match,
        "osdDecoded": osd_decoded,
        "prnuScore": prnu_score,
        "prnuMatch": prnu_match,
        "prnuAvailable": prnu_available,
        # OSD-burned JPEG for YOLO — stock counts share the attested nonce frame.
        "frameBytes": frame_bytes,
    }


def _tesseract_available() -> bool:
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False
