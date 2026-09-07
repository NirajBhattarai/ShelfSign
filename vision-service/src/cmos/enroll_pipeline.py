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

from .capture import capture_snapshot, saturation_variance
from .isapi_client import ISAPIClient
from .isapi_controls import set_ir_brightness, set_ircut_mode, set_osd_text
from .puf_coords import bits_to_bytes, extract_bits, select_stable_coords_from_burst
from .puf_fuzzy_extractor import BCHParams, enroll as fx_enroll, pick_bch_params, regenerate as fx_regenerate
from .puf_keys import derive_address, derive_private_key, zero_key_material

# Tuned down from siliconwitness's research-grade defaults so "Save &
# enroll" finishes in well under a minute -- at the cost of a smaller
# empirical-stability sample than the original multi-hour study.
DEFAULT_N_CAPTURES = 6
DEFAULT_CAPTURE_INTERVAL_S = 1.0
DEFAULT_SETTLE_S = 8.0
DEFAULT_CONFIRM_POLL_S = 15.0
DEFAULT_CANDIDATE_BITS = 256
DEFAULT_STABILITY_POOL = 4096
ASSUMED_WORST_CASE_FLIPS_FLOOR = 13  # ~5% of 256, siliconwitness's decision boundary


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


def _force_night_mode(client: ISAPIClient, settle_s: float, confirm_poll_s: float) -> None:
    set_ircut_mode(client, "night")
    set_ir_brightness(client, 100)

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
        _force_night_mode(client, settle_s=settle_s, confirm_poll_s=confirm_poll_s)

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
    _force_night_mode(client, settle_s=settle_s, confirm_poll_s=confirm_poll_s)

    cap = capture_snapshot(client)
    bits = extract_bits(cap.array, record.coordinates)
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
