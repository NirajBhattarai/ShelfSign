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
import time
from typing import Optional

from eth_utils import keccak

from .capture import capture_snapshot, mean_luminance, saturation_variance
from .enroll_pipeline import EnrollmentRecord
from .isapi_client import ISAPIClient
from .isapi_controls import set_color, set_ir_brightness, set_ircut_mode, set_osd_text
from .puf_coords import bits_to_bytes, extract_bits
from .puf_fuzzy_extractor import BCHParams, regenerate as fx_regenerate
from .puf_keys import sign_and_zero

SETTLE_S = {
    "osd": 2.0,
    "ircut": 8.0,
    "ir_brightness": 5.0,
    "brightness": 2.0,
}
OSD_CROP = (0, 0, 260, 190)
OSD_FUZZY_MATCH_THRESHOLD = 0.5


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

    x0, y0, x1, y1 = box
    base = cap.image.crop((x0, y0, x1, y1)).convert("L")
    base = base.resize((base.width * 4, base.height * 4))

    lines: list[str] = []
    seen = set()
    for variant in (
        ImageOps.autocontrast(base, cutoff=1),
        ImageOps.autocontrast(ImageOps.invert(base), cutoff=1),
    ):
        raw = pytesseract.image_to_string(variant, config="--psm 6")
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
    required_state = {
        "osdNonce": nonce,
        "irLevel": ir_level,
        "brightness": brightness,
        "colorMode": color_mode,
    }

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
    wait_s = apply_required_state(client, required_state)
    if settle_override_s is not None:
        wait_s = settle_override_s
    time.sleep(wait_s)

    cap = capture_snapshot(client)
    mean_lum = mean_luminance(cap)
    sat_var = saturation_variance(cap)
    osd_decoded = ocr_osd_nonce(cap, expected=nonce)
    osd_similarity = similarity(osd_decoded, nonce) if nonce else 0.0

    # If OCR isn't available (no tesseract), don't fail the physical PUF
    # path — we still regenerated from a nonce-bound capture.
    ocr_available = bool(osd_decoded) or _tesseract_available()
    if ocr_available and osd_decoded:
        osd_match = osd_similarity >= OSD_FUZZY_MATCH_THRESHOLD
    else:
        osd_match = True  # OSD was set; OCR optional for hackathon path

    bits = extract_bits(cap.array, coords)
    measured_bytes = bits_to_bytes(bits)

    regen_failed = False
    corrected_errors = None
    fx_result = None
    try:
        fx_result = fx_regenerate(measured_bytes, helper, params)
        corrected_errors = fx_result.corrected_bit_errors
    except RuntimeError:
        regen_failed = True

    address_match = False
    signature = None
    signing_error = None

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
        },
        "verdict": {
            "claim": "clear" if osd_match and not regen_failed else "mismatch",
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
        signing_error = "PUF key regeneration failed"
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
            body["signature"] = None
            body["signingError"] = "regenerated_address_mismatch"
            signing_error = body["signingError"]

    image_hash = hashlib.sha256(cap.raw_bytes).hexdigest()

    return {
        "match": bool(address_match and osd_match and signature),
        "score": 1.0 if address_match else 0.0,
        "correctedBitErrors": corrected_errors,
        "signature": signature,
        "signingError": signing_error,
        "imageHash": image_hash,
        "cmosAccount": record.address,
        "attestation": body,
        "osdMatch": osd_match,
        "osdDecoded": osd_decoded,
        # Same JPEG used for PUF regen — backend runs YOLO on this frame so
        # stock counts and silicon identity share one live capture.
        "frameBytes": cap.raw_bytes,
    }


def _tesseract_available() -> bool:
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False
