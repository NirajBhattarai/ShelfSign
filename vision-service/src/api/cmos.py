import base64
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.cmos.fingerprint import enroll, match
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


@router.post("/enroll", response_model=EnrollResponse)
def enroll_camera(body: EnrollRequest) -> EnrollResponse:
    try:
        cmos_account = enroll(body.cameraId, host=body.host, username=body.username, password=body.password)
    except Exception as e:
        # Real hardware enrollment failed (unreachable camera, bad
        # credentials, burst too unstable for BCH to correct) -- surface it
        # as a failure rather than falling back to a fabricated identity.
        raise HTTPException(status_code=502, detail=f"enrollment_failed: {e}")
    return EnrollResponse(cmosAccount=cmos_account)


@router.post("/match", response_model=MatchResponse)
def match_camera(body: MatchRequest) -> MatchResponse:
    frame = base64.b64decode(body.frameBase64) if body.frameBase64 else b""
    result = match(
        body.cmosAccount, frame,
        camera_id=body.cameraId, host=body.host, username=body.username, password=body.password,
    )
    return MatchResponse(match=result["match"], score=result["score"])


@router.get("/stream")
def stream_camera(host: str, username: str, password: str) -> StreamingResponse:
    """Near-live MJPEG relay for a supplier viewing their own camera --
    see live_stream.py's module docstring for why this isn't real video."""
    return StreamingResponse(
        mjpeg_frames(host, username, password),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
    )
