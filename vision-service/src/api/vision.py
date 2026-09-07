import base64
import binascii
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.vision.capture_detect import capture_and_detect, capture_with_nonce
from src.vision.detect import detect_stock

router = APIRouter()


class DetectRequest(BaseModel):
    frameBase64: Optional[str] = None
    host: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    nonce: Optional[str] = None
    includeFrame: bool = False
    # Warehouse categories selected at create time (Chair / Monitor / Table).
    allowedCategories: Optional[list[str]] = None
    allowedSkus: Optional[list[str]] = None


class StockItem(BaseModel):
    sku: str
    count: int
    confidence: float = 1.0
    shelf: str = "-"
    category: Optional[str] = None


class DetectResponse(BaseModel):
    items: list[StockItem]
    model: str
    modelHash: str
    imageHash: str
    detectionCount: int
    totalUnits: int
    engine: str
    nonceBound: bool = False
    frameBase64: Optional[str] = None


@router.post("/detect", response_model=DetectResponse)
def detect(body: DetectRequest) -> DetectResponse:
    """
    Count stock with YOLO/PyTorch.
    Provide either frameBase64, or camera host/username/password to capture live.
    Optional nonce overlays on the camera OSD before capture.
    When allowedCategories is set, only those warehouse categories are counted.
    """
    try:
        if body.frameBase64:
            try:
                frame = base64.b64decode(body.frameBase64)
            except binascii.Error as e:
                raise HTTPException(status_code=400, detail=f"invalid_frame: {e}")
            if body.nonce and body.host and body.username and body.password:
                result = capture_and_detect(
                    body.host,
                    body.username,
                    body.password,
                    nonce=body.nonce,
                    allowed_categories=body.allowedCategories,
                    allowed_skus=body.allowedSkus,
                )
            else:
                result = detect_stock(
                    frame,
                    allowed_categories=body.allowedCategories,
                    allowed_skus=body.allowedSkus,
                )
                result["nonceBound"] = False
                result["frameBytes"] = frame
        elif body.host and body.username and body.password:
            result = capture_and_detect(
                body.host,
                body.username,
                body.password,
                nonce=body.nonce,
                allowed_categories=body.allowedCategories,
                allowed_skus=body.allowedSkus,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide frameBase64 or camera host/username/password",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"detect_failed: {e}")

    frame_b64 = None
    if body.includeFrame and result.get("frameBytes"):
        frame_b64 = base64.b64encode(result["frameBytes"]).decode("ascii")

    return DetectResponse(
        items=result["items"],
        model=result["model"],
        modelHash=result["modelHash"],
        imageHash=result["imageHash"],
        detectionCount=result["detectionCount"],
        totalUnits=result["totalUnits"],
        engine=result["engine"],
        nonceBound=bool(result.get("nonceBound")),
        frameBase64=frame_b64,
    )


class BindNonceRequest(BaseModel):
    host: str
    username: str
    password: str
    nonce: str = Field(min_length=4)


class BindNonceResponse(BaseModel):
    ok: bool
    imageHash: str
    frameBase64: Optional[str] = None


@router.post("/bind-nonce", response_model=BindNonceResponse)
def bind_nonce(body: BindNonceRequest) -> BindNonceResponse:
    """Show the challenge nonce on camera OSD and return a fresh still."""
    try:
        frame = capture_with_nonce(body.host, body.username, body.password, body.nonce)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"bind_failed: {e}")

    from src.vision.detect import image_hash

    return BindNonceResponse(
        ok=True,
        imageHash=image_hash(frame),
        frameBase64=base64.b64encode(frame).decode("ascii"),
    )
