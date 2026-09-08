"""
Real CMOS/PUF enrollment pipeline: burst capture + empirical-stability
coordinate selection + BCH fuzzy extractor + secp256k1 key derivation.

Adapted from siliconwitness's gateway/cli.py::cmd_enroll
(/Users/niraj/Desktop/siliconwitness) for a multi-tenant setting -- many
suppliers, many cameras, each with its own host/username/password from the
`cameras` table, instead of one hardcoded camera read from a global .env --
and tuned for a demo-length HTTP request instead of siliconwitness's
research-grade defaults (15 captures / 2s apart / up to 90s of night-mode
settle). Same real methodology, shorter burst: see the DEFAULT_* constants
below for the exact tradeoff, and siliconwitness/gateway/BER_REPORT_V2.md
for why empirical-stability selection (not contrast-margin alone) matters.
"""
from __future__ import annotations

import random
import string
import time
from dataclasses import dataclass

import numpy as np

from .capture import capture_snapshot, saturation_variance
from .isapi_client import ISAPIClient
from .isapi_controls import set_color, set_ir_brightness, set_ircut_mode, set_osd_text
from .puf_coords import bits_to_bytes, extract_bits, select_stable_coords_from_burst
from .puf_fuzzy_extractor import BCHParams, enroll as fx_enroll, pick_bch_params, regenerate as fx_regenerate
from .puf_keys import derive_address, derive_private_key, zero_key_material

# Tuned toward reliable regen on live Hikvision (challenge must re-derive
# the same address). Still shorter than siliconwitness research defaults
# (15 captures / 2s / long settle) so HTTP enroll finishes in ~1–2 min.
DEFAULT_N_CAPTURES = 12
DEFAULT_CAPTURE_INTERVAL_S = 2.0
DEFAULT_SETTLE_S = 10.0
DEFAULT_CONFIRM_POLL_S = 20.0
DEFAULT_CANDIDATE_BITS = 384
DEFAULT_STABILITY_POOL = 6144
# Floor high enough that BCH t has headroom for live IR drift between
# enroll and challenge (short bursts often report worst_flips=0).
ASSUMED_WORST_CASE_FLIPS_FLOOR = 24

# Must match challenge_pipeline.respond_to_challenge defaults — enroll and
# challenge extract PUF bits under the same IR / brightness / colorMode state.
ENROLL_IR_LEVEL = 100
ENROLL_BRIGHTNESS = 50
ENROLL_COLOR_MODE = "night"


@dataclass
class EnrollmentRecord:
    address: str
    helper_hex: str
    coordinates: list
    bch_params: dict
    candidate_bits: int
    burst_worst_flips: int
    enrolled_at: float

    def to_json(self) -> dict:
        return {
            "address": self.address,
            "helper_hex": self.helper_hex,
            "coordinates": [list(c) for c in self.coordinates],
            "bch_params": self.bch_params,
            "candidate_bits": self.candidate_bits,
            "burst_worst_flips": self.burst_worst_flips,
            "enrolled_at": self.enrolled_at,
        }

    @staticmethod
    def from_json(data: dict) -> "EnrollmentRecord":
        return EnrollmentRecord(
            address=data["address"],
            helper_hex=data["helper_hex"],
            coordinates=[tuple(c) for c in data["coordinates"]],
            bch_params=data["bch_params"],
            candidate_bits=data["candidate_bits"],
            burst_worst_flips=data["burst_worst_flips"],
            enrolled_at=data["enrolled_at"],
        )


def _force_challenge_aligned_state(
    client: ISAPIClient, settle_s: float, confirm_poll_s: float
) -> None:
    """Drive the camera to the same actuator state challenge uses before
    capturing PUF bits. Mismatch here (e.g. enroll without brightness while
    challenge sets brightness=50) inflates bit flips past BCH capacity."""
    set_ircut_mode(client, ENROLL_COLOR_MODE)
    set_ir_brightness(client, ENROLL_IR_LEVEL)
    set_color(client, brightness=ENROLL_BRIGHTNESS)

    t0 = time.monotonic()
    while time.monotonic() - t0 < confirm_poll_s:
        cap = capture_snapshot(client)
        if saturation_variance(cap) < 5.0:  # night mode collapses to monochrome
            break
        time.sleep(1.0)
    time.sleep(settle_s)


def enroll_from_camera(
    host: str,
    username: str,
    password: str,
    n_captures: int = DEFAULT_N_CAPTURES,
    capture_interval_s: float = DEFAULT_CAPTURE_INTERVAL_S,
    settle_s: float = DEFAULT_SETTLE_S,
    confirm_poll_s: float = DEFAULT_CONFIRM_POLL_S,
    candidate_bits: int = DEFAULT_CANDIDATE_BITS,
    stability_pool: int = DEFAULT_STABILITY_POOL,
) -> EnrollmentRecord:
    """Burst-capture + empirical-stability enrollment against a live
    Hikvision camera. Raises (ISAPIError, requests exceptions, ValueError)
    if the camera is unreachable, rejects the credentials, or the burst is
    too small -- callers should treat any exception as enrollment failure,
    never fall back to a fabricated identity."""
    client = ISAPIClient(host=host, user=username, password=password)

    from .camera_gate import camera_snapshot_lock

    # Hold exclusive camera access for the whole burst so live MJPEG cannot
    # interleave and trip deviceBusy mid-enrollment.
    with camera_snapshot_lock(timeout_s=180.0):
        _force_challenge_aligned_state(
            client, settle_s=settle_s, confirm_poll_s=confirm_poll_s
        )

        captures = []
        for i in range(n_captures):
            nonce = "".join(random.choices(string.hexdigits.lower()[:16], k=6))
            set_osd_text(client, nonce, enabled=True, position_x=0, position_y=576)
            time.sleep(0.5)  # OSD render settle
            cap = capture_snapshot(client)
            captures.append(cap.array)
            if i < n_captures - 1:
                time.sleep(capture_interval_s)

        coords, reference_bits, flip_counts = select_stable_coords_from_burst(
            captures, candidate_pool=stability_pool, n_final=candidate_bits,
        )
        burst_worst_flips = int(flip_counts.max())
        measured_bytes = bits_to_bytes(reference_bits)

        assumed_worst_flips = max(ASSUMED_WORST_CASE_FLIPS_FLOOR, burst_worst_flips * 3)
        params = pick_bch_params(assumed_worst_flips=assumed_worst_flips, candidate_bits=len(measured_bytes) * 8)

        result = fx_enroll(measured_bytes, params)
        pk = derive_private_key(result.key)
        address = derive_address(pk)
        zero_key_material(result.key, pk)
        del pk

        return EnrollmentRecord(
            address=address,
            helper_hex=result.helper.hex(),
            coordinates=coords,
            bch_params={
                "m": params.m, "t": params.t, "n": params.n,
                "data_bytes": params.data_bytes, "buffer_bytes": params.buffer_bytes,
                "assumed_worst_flips": params.assumed_worst_flips,
                "achieved_margin": params.achieved_margin,
            },
            candidate_bits=len(measured_bytes) * 8,
            burst_worst_flips=burst_worst_flips,
            enrolled_at=time.time(),
        )


def regenerate_from_camera(
    host: str,
    username: str,
    password: str,
    record: EnrollmentRecord,
    settle_s: float = DEFAULT_SETTLE_S,
    confirm_poll_s: float = DEFAULT_CONFIRM_POLL_S,
) -> tuple[str, int]:
    """Re-derive the signing address from a fresh capture and confirm it
    matches the enrolled address. Returns (address, corrected_bit_errors).
    Raises RuntimeError if BCH decoding fails or the address doesn't match."""
    client = ISAPIClient(host=host, user=username, password=password)
    _force_challenge_aligned_state(
        client, settle_s=settle_s, confirm_poll_s=confirm_poll_s
    )

    # Same majority vote as challenge — keep match() and challenge consistent.
    bit_rows = []
    for i in range(3):
        cap = capture_snapshot(client)
        bit_rows.append(extract_bits(cap.array, record.coordinates))
        if i < 2:
            time.sleep(0.35)
    stacked = np.stack(bit_rows, axis=0)
    bits = (stacked.sum(axis=0) >= 2).astype(np.uint8)
    measured_bytes = bits_to_bytes(bits)

    bp = record.bch_params
    params = BCHParams(
        m=bp["m"], t=bp["t"], n=bp["n"], ecc_bits=0, ecc_bytes=0,
        data_bytes=bp["data_bytes"], buffer_bytes=bp["buffer_bytes"],
        assumed_worst_flips=bp["assumed_worst_flips"], achieved_margin=bp["achieved_margin"],
    )
    helper = bytes.fromhex(record.helper_hex)
    result = fx_regenerate(measured_bytes, helper, params)

    pk = derive_private_key(result.key)
    address = derive_address(pk)
    zero_key_material(result.key, pk)
    del pk

    if address != record.address:
        raise RuntimeError(f"Regenerated address {address} does not match enrolled address {record.address}")

    return address, result.corrected_bit_errors
