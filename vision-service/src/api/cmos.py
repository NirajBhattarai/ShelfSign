import base64
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.cmos.fingerprint import (
    challenge,
    enroll,
    enrollment_address,
    forget_enrollment,
    has_enrollment,
    match,
)
from src.cmos.live_stream import BOUNDARY, mjpeg_frames

router = APIRouter()


class EnrollRequest(BaseModel):
    cameraId: str
    host: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class EnrollResponse(BaseModel):
    cmosAccount: str


class MatchRequest(BaseModel):
    cmosAccount: str
    frameBase64: str = ""
    cameraId: Optional[str] = None
    host: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class MatchResponse(BaseModel):
    match: bool
    score: float
    correctedBitErrors: Optional[int] = None
    reason: Optional[str] = None


class ChallengeRequest(BaseModel):
    cameraId: str
    cmosAccount: str
    nonce: str = Field(min_length=4)
    host: str
    username: str
    password: str


class ChallengeResponse(BaseModel):
    match: bool
    score: float
    correctedBitErrors: Optional[int] = None
    signature: Optional[str] = None
    signingError: Optional[str] = None
    imageHash: str
    cmosAccount: str
    osdMatch: bool = False
    osdDecoded: str = ""
    attestation: Optional[dict] = None
    frameBase64: Optional[str] = None
    prnuScore: Optional[float] = None
    prnuMatch: bool = True
    prnuAvailable: bool = False


@router.post("/enroll", response_model=EnrollResponse)
def enroll_camera(body: EnrollRequest) -> EnrollResponse:
    try:
        cmos_account = enroll(
            body.cameraId,
            host=body.host,
            username=body.username,
            password=body.password,
        )
    except ValueError as e:
        # synthetic_device_rejected / synthetic_replay_rejected / bad input
        raise HTTPException(status_code=422, detail=f"enrollment_failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"enrollment_failed: {e}")
    return EnrollResponse(cmosAccount=cmos_account)


@router.get("/enrollment/{camera_id}")
def get_enrollment(camera_id: str) -> dict:
    """Return whether vision-service has a real PUF enrollment on disk."""
    if not has_enrollment(camera_id):
        return {"enrolled": False, "cmosAccount": None}
    return {"enrolled": True, "cmosAccount": enrollment_address(camera_id)}


@router.delete("/enrollment/{camera_id}")
def delete_enrollment(camera_id: str) -> dict:
    """Forget a camera's enrollment -- call when its host/username/password
    change, since the old record belongs to a different physical device."""
    deleted = forget_enrollment(camera_id)
    return {"deleted": deleted}


@router.post("/match", response_model=MatchResponse)
def match_camera(body: MatchRequest) -> MatchResponse:
    frame = base64.b64decode(body.frameBase64) if body.frameBase64 else b""
    result = match(
        body.cmosAccount,
        frame,
        camera_id=body.cameraId,
        host=body.host,
        username=body.username,
        password=body.password,
    )
    return MatchResponse(
        match=bool(result.get("match")),
        score=float(result.get("score") or 0.0),
        correctedBitErrors=result.get("correctedBitErrors"),
        reason=result.get("reason"),
    )


@router.post("/challenge", response_model=ChallengeResponse)
def challenge_camera(body: ChallengeRequest) -> ChallengeResponse:
    """SiliconWitness challenge-response: OSD nonce + PUF regen + sign."""
    try:
        result = challenge(
            camera_id=body.cameraId,
            cmos_account=body.cmosAccount,
            nonce=body.nonce,
            host=body.host,
            username=body.username,
            password=body.password,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"challenge_failed: {e}")

    return ChallengeResponse(
        match=bool(result.get("match")),
        score=float(result.get("score") or 0.0),
        correctedBitErrors=result.get("correctedBitErrors"),
        signature=result.get("signature"),
        signingError=result.get("signingError"),
        imageHash=str(result.get("imageHash") or ""),
        cmosAccount=str(result.get("cmosAccount") or body.cmosAccount),
        osdMatch=bool(result.get("osdMatch")),
        osdDecoded=str(result.get("osdDecoded") or ""),
        attestation=result.get("attestation"),
        frameBase64=result.get("frameBase64"),
        prnuScore=result.get("prnuScore"),
        prnuMatch=bool(result.get("prnuMatch", True)),
        prnuAvailable=bool(result.get("prnuAvailable")),
    )


class DeviceCheckRequest(BaseModel):
    host: str
    username: str
    password: str


@router.post("/device-check")
def device_check(body: DeviceCheckRequest) -> dict:
    """Probe ISAPI deviceInfo — used when editing camera credentials so the
    backend can flag synthetic stubs before attest."""
    from src.cmos.device_authenticity import (
        SyntheticDeviceError,
        assert_physical_device,
        device_looks_synthetic,
        fetch_device_info,
    )
    from src.cmos.isapi_client import ISAPIClient, ISAPIError

    try:
        client = ISAPIClient(
            host=body.host,
            user=body.username,
            password=body.password,
            timeout=5.0,
        )
        info = fetch_device_info(client)
        synthetic = device_looks_synthetic(info)
        if not synthetic:
            assert_physical_device(client)
        return {
            "ok": not synthetic,
            "synthetic": synthetic,
            "serialNumber": info.get("serialNumber"),
            "model": info.get("model"),
            "deviceName": info.get("deviceName"),
        }
    except SyntheticDeviceError as e:
        return {"ok": False, "synthetic": True, "detail": str(e)}
    except (ISAPIError, ValueError, OSError) as e:
        raise HTTPException(status_code=502, detail=f"device_check_failed: {e}")


@router.get("/stream")
def stream_camera(host: str, username: str, password: str) -> StreamingResponse:
    """Near-live MJPEG relay for a supplier viewing their own camera --
    see live_stream.py's module docstring for why this isn't real video."""
    return StreamingResponse(
        mjpeg_frames(host, username, password),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
    )
