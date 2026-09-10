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

import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .capture import capture_snapshot, saturation_variance
from .device_authenticity import (
    assert_live_sensor_burst,
    assert_physical_device,
)
from .isapi_client import ISAPIClient
from .isapi_controls import set_color, set_ir_brightness, set_ircut_mode, set_osd_text
from .prnu import estimate_fingerprint
from .puf_coords import bits_to_bytes, extract_bits, select_stable_coords_from_burst
from .puf_fuzzy_extractor import (
    BCHParams,
    enroll as fx_enroll,
    pick_bch_params,
    regenerate as fx_regenerate,
)
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
    # Classical PRNU reference pattern (see prnu.py) -- deliberately NOT part
    # of to_json/from_json. It's a per-pixel float array the size of the
    # sensor (megabytes), so fingerprint.py persists it as a sidecar .npy
    # file next to the JSON record instead of bloating the enrollment JSON.
    prnu_fingerprint: Optional[np.ndarray] = field(default=None, repr=False)

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
    challenge sets brightness=50) inflates bit flips past BCH capacity.

    OSD is disabled here on purpose: burning overlay text changes AE /
    JPEG quantization enough to flip near-threshold PUF bits and can make
    BCH *miscorrect* (low correctedBitErrors, wrong address). Challenge
    extracts bits with OSD off too, then burns the nonce afterward.
    """
    # Avoid re-commanding IRCUT when already in night — the mechanical filter
    # can transiently disturb exposure even on a no-op mode PUT.
    from .isapi_controls import get_ircut_mode

    current = get_ircut_mode(client)
    if current != ENROLL_COLOR_MODE:
        set_ircut_mode(client, ENROLL_COLOR_MODE)
    set_ir_brightness(client, ENROLL_IR_LEVEL)
    set_color(client, brightness=ENROLL_BRIGHTNESS)
    # Stable AE for bit extraction — must match challenge_pipeline.
    set_osd_text(client, "", enabled=False)

    t0 = time.monotonic()
    while time.monotonic() - t0 < confirm_poll_s:
        cap = capture_snapshot(client)
        if saturation_variance(cap) < 5.0:  # night mode collapses to monochrome
            break
        time.sleep(1.0)
    time.sleep(settle_s)


def _majority_vote_bits(
    client: ISAPIClient,
    coords: list,
    *,
    n_samples: int = 3,
    interval_s: float = 0.35,
) -> np.ndarray:
    """Same 3-frame majority vote challenge uses for PUF regeneration."""
    bit_rows = []
    for i in range(n_samples):
        cap = capture_snapshot(client)
        bit_rows.append(extract_bits(cap.array, coords))
        if i < n_samples - 1:
            time.sleep(interval_s)
    stacked = np.stack(bit_rows, axis=0)
    return (stacked.sum(axis=0) >= (n_samples // 2 + 1)).astype(np.uint8)


def _self_check_enrollment(client: ISAPIClient, record: "EnrollmentRecord") -> None:
    """Confirm a fresh challenge-style capture regenerates the enrolled address.

    Re-applies the same IR / night / OSD-off actuator path challenge uses —
    a self-check that only majority-votes the already-settled enroll burst
    can pass while the next /cmos/challenge fails after IRCUT settle.
    """

    def _once() -> None:
        _force_challenge_aligned_state(
            client, settle_s=DEFAULT_SETTLE_S, confirm_poll_s=DEFAULT_CONFIRM_POLL_S
        )
        set_osd_text(client, "", enabled=False)
        time.sleep(2.0)
        bits = _majority_vote_bits(client, record.coordinates)
        measured_bytes = bits_to_bytes(bits)
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
        helper = bytes.fromhex(record.helper_hex)
        result = fx_regenerate(
            measured_bytes,
            helper,
            params,
            with_crc=bool(bp.get("helper_crc")),
        )
        pk = derive_private_key(result.key)
        address = derive_address(pk)
        zero_key_material(result.key, pk)
        del pk
        if address.lower() != record.address.lower():
            raise RuntimeError(
                "enrollment_self_check_failed:"
                f"regenerated={address} enrolled={record.address} "
                f"corrected_bit_errors={result.corrected_bit_errors}"
            )

    _once()
    # Second pass after AE has another chance to drift.
    time.sleep(2.0)
    _once()


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
    max_attempts: int = 3,
) -> EnrollmentRecord:
    """Burst-capture + empirical-stability enrollment against a live
    Hikvision camera. Raises (ISAPIError, requests exceptions, ValueError)
    if the camera is unreachable, rejects the credentials, or the burst is
    too small -- callers should treat any exception as enrollment failure,
    never fall back to a fabricated identity.

    Retries a few times with longer settle when the post-enroll self-check
    (challenge-style majority vote) cannot regenerate the new address —
    the failure mode that previously surfaced as puf_enrollment_stale on
    the very next /cmos/challenge.
    """
    client = ISAPIClient(host=host, user=username, password=password)

    from .camera_gate import camera_snapshot_lock

    # Hold exclusive camera access for the whole burst so live MJPEG cannot
    # interleave and trip deviceBusy mid-enrollment.
    with camera_snapshot_lock(host=host, timeout_s=300.0):
        # Refuse known ISAPI stubs before we invent a self-consistent PUF identity.
        assert_physical_device(client)

        last_err: Optional[Exception] = None
        for attempt in range(max_attempts):
            attempt_settle = settle_s + attempt * 5.0
            try:
                return _enroll_once(
                    client,
                    n_captures=n_captures,
                    capture_interval_s=capture_interval_s,
                    settle_s=attempt_settle,
                    confirm_poll_s=confirm_poll_s,
                    candidate_bits=candidate_bits,
                    stability_pool=stability_pool,
                )
            except RuntimeError as e:
                # Self-check / regen failures are retryable; other RuntimeErrors
                # from BCH param search should also retry with longer settle.
                last_err = e
                if attempt + 1 >= max_attempts:
                    break
                time.sleep(2.0)
        assert last_err is not None
        raise last_err


def _enroll_once(
    client: ISAPIClient,
    *,
    n_captures: int,
    capture_interval_s: float,
    settle_s: float,
    confirm_poll_s: float,
    candidate_bits: int,
    stability_pool: int,
) -> EnrollmentRecord:
    _force_challenge_aligned_state(
        client, settle_s=settle_s, confirm_poll_s=confirm_poll_s
    )

    captures = []
    raw_jpegs = []
    # Keep OSD disabled for the whole burst (same as challenge bit extract).
    # Mild brightness dither so selected coords must survive small AE shifts —
    # without this, a static burst often reports worst_flips=0 on scene edges
    # that later flip under challenge and trigger BCH miscorrection.
    brightness_cycle = (
        ENROLL_BRIGHTNESS - 6,
        ENROLL_BRIGHTNESS - 2,
        ENROLL_BRIGHTNESS,
        ENROLL_BRIGHTNESS + 2,
        ENROLL_BRIGHTNESS + 6,
    )
    for i in range(n_captures):
        b = max(0, min(100, brightness_cycle[i % len(brightness_cycle)]))
        set_color(client, brightness=b)
        time.sleep(0.45)
        cap = capture_snapshot(client)
        captures.append(cap.array)
        raw_jpegs.append(cap.raw_bytes)
        if i < n_captures - 1:
            time.sleep(capture_interval_s)

    set_color(client, brightness=ENROLL_BRIGHTNESS)
    time.sleep(0.5)

    assert_live_sensor_burst(raw_jpegs)

    coords, reference_bits, flip_counts = select_stable_coords_from_burst(
        captures,
        candidate_pool=stability_pool,
        n_final=candidate_bits,
    )
    burst_worst_flips = int(flip_counts.max())
    prnu_fingerprint = estimate_fingerprint(captures)
    measured_bytes = bits_to_bytes(reference_bits)

    # Short static bursts often report worst_flips=0; keep a high BCH floor
    # and CRC so challenge miscorrections are rejected instead of shipping a
    # wrong address as "success with nerr=3".
    assumed_worst_flips = max(
        ASSUMED_WORST_CASE_FLIPS_FLOOR,
        burst_worst_flips * 3,
        24 if burst_worst_flips == 0 else 0,
    )
    params = pick_bch_params(
        assumed_worst_flips=assumed_worst_flips,
        candidate_bits=len(measured_bytes) * 8,
    )

    result = fx_enroll(measured_bytes, params)
    pk = derive_private_key(result.key)
    address = derive_address(pk)
    zero_key_material(result.key, pk)
    del pk

    record = EnrollmentRecord(
        address=address,
        helper_hex=result.helper.hex(),
        coordinates=coords,
        bch_params={
            "m": params.m,
            "t": params.t,
            "n": params.n,
            "data_bytes": params.data_bytes,
            "buffer_bytes": params.buffer_bytes,
            "assumed_worst_flips": params.assumed_worst_flips,
            "achieved_margin": params.achieved_margin,
            # v2 helpers embed CRC-16 in the BCH message (see puf_fuzzy_extractor).
            "helper_crc": True,
        },
        candidate_bits=len(measured_bytes) * 8,
        burst_worst_flips=burst_worst_flips,
        enrolled_at=time.time(),
        prnu_fingerprint=prnu_fingerprint,
    )
    _self_check_enrollment(client, record)
    return record


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
    bits = _majority_vote_bits(client, record.coordinates)
    measured_bytes = bits_to_bytes(bits)

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
    helper = bytes.fromhex(record.helper_hex)
    result = fx_regenerate(
        measured_bytes,
        helper,
        params,
        with_crc=bool(bp.get("helper_crc")),
    )

    pk = derive_private_key(result.key)
    address = derive_address(pk)
    zero_key_material(result.key, pk)
    del pk

    if address != record.address:
        raise RuntimeError(
            f"Regenerated address {address} does not match enrolled address {record.address}"
        )

    return address, result.corrected_bit_errors
