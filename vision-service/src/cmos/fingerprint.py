import json
import os
from pathlib import Path
from typing import Optional

from .challenge_pipeline import respond_to_challenge
from .enroll_pipeline import (
    EnrollmentRecord,
    enroll_from_camera,
    regenerate_from_camera,
)

# Real enrollment (see enroll_pipeline.py, ported from
# /Users/niraj/Desktop/siliconwitness) runs when a camera's host/username/
# password are supplied. Enrollment records (helper data + coordinates +
# BCH params + derived address -- never raw key material) are persisted
# per-camera here so a later regeneration/match can reuse them.
ENROLLMENTS_DIR = Path(os.environ.get("CMOS_ENROLLMENTS_DIR", "data/enrollments"))

def _record_path(camera_id: str) -> Path:
    return ENROLLMENTS_DIR / f"{camera_id}.json"


def _load_record(camera_id: str) -> Optional[EnrollmentRecord]:
    path = _record_path(camera_id)
    if not path.exists():
        return None
    return EnrollmentRecord.from_json(json.loads(path.read_text()))


def _save_record(camera_id: str, record: EnrollmentRecord) -> None:
    ENROLLMENTS_DIR.mkdir(parents=True, exist_ok=True)
    _record_path(camera_id).write_text(json.dumps(record.to_json(), indent=2))


def has_enrollment(camera_id: str) -> bool:
    return _record_path(camera_id).exists()


def enrollment_address(camera_id: str) -> Optional[str]:
    record = _load_record(camera_id)
    return record.address if record else None


def enroll(
    camera_id: str,
    host: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> str:
    """Enroll a camera's CMOS/PUF identity from the live sensor.

    Requires host/username/password. Runs burst-capture + BCH fuzzy-extractor
    (enroll_pipeline.py). Failures (unreachable camera, bad credentials,
    unstable burst) raise — never invent a stub identity."""
    if not (host and username and password):
        raise ValueError("camera_credentials_required_for_puf_enroll")
    record = enroll_from_camera(host=host, username=username, password=password)
    _save_record(camera_id, record)
    return record.address


def match(
    cmos_account: str,
    frame: bytes,
    camera_id: Optional[str] = None,
    host: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> dict:
    """Verify a camera still matches its enrolled CMOS identity via live
    PUF regeneration. `frame` is unused — regen needs a fresh sensor
    capture at the enrolled coordinates."""
    if not (camera_id and host and username and password):
        return {
            "match": False,
            "score": 0.0,
            "reason": "camera_credentials_required_for_puf_match",
        }
    record = _load_record(camera_id)
    if record is None:
        return {"match": False, "score": 0.0, "reason": "no_enrollment"}
    try:
        address, corrected_bit_errors = regenerate_from_camera(
            host=host,
            username=username,
            password=password,
            record=record,
        )
        return {
            "match": address == cmos_account,
            "score": 1.0 if address == cmos_account else 0.0,
            "correctedBitErrors": corrected_bit_errors,
        }
    except Exception as e:
        return {"match": False, "score": 0.0, "reason": str(e)}


def challenge(
    camera_id: str,
    cmos_account: str,
    nonce: str,
    host: str,
    username: str,
    password: str,
) -> dict:
    """SiliconWitness physical challenge-response attestation.

    Applies OSD nonce + IR/brightness actuators, regenerates the PUF key
    from a fresh capture, and signs. `match` is true only when the
    regenerated address equals both the enrollment record and the expected
    `cmos_account`.
    """
    record = _load_record(camera_id)
    if record is None:
        raise FileNotFoundError(f"no_enrollment_for_camera:{camera_id}")
    if record.address.lower() != cmos_account.lower():
        raise ValueError("cmos_account_mismatch_enrollment")

    result = respond_to_challenge(
        host=host,
        username=username,
        password=password,
        record=record,
        nonce=nonce,
    )
    if result.get("cmosAccount", "").lower() != cmos_account.lower():
        result["match"] = False
        result["score"] = 0.0

    # Expose the capture as base64 for the backend YOLO pass (same frame).
    frame_bytes = result.pop("frameBytes", None)
    if isinstance(frame_bytes, (bytes, bytearray)):
        import base64

        result["frameBase64"] = base64.b64encode(frame_bytes).decode("ascii")
    else:
        result["frameBase64"] = None
    return result
