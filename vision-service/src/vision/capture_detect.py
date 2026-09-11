"""Capture a nonce-bound frame from a Hikvision camera and run stock detection."""

from __future__ import annotations

import time
from typing import Optional

from src.cmos.capture import capture_snapshot
from src.cmos.challenge_pipeline import osd_display_text
from src.cmos.isapi_client import ISAPIClient
from src.cmos.isapi_controls import set_osd_text
from src.vision.detect import detect_stock


def capture_with_nonce(
    host: str,
    username: str,
    password: str,
    nonce: str,
    settle_s: float = 0.6,
) -> bytes:
    """Overlay the challenge nonce on the camera OSD, then grab a JPEG still."""
    client = ISAPIClient(host=host, user=username, password=password)
    # Keep OSD short — Hikvision text overlays truncate long strings; OCR
    # matches the same shortened label used by /cmos/challenge.
    overlay = osd_display_text(nonce)
    set_osd_text(client, overlay, enabled=True)
    time.sleep(settle_s)
    cap = capture_snapshot(client)
    return cap.raw_bytes


def capture_and_detect(
    host: str,
    username: str,
    password: str,
    nonce: Optional[str] = None,
    allowed_categories: Optional[list] = None,
    allowed_skus: Optional[list] = None,
) -> dict:
    """
    Capture from camera (optionally binding nonce on OSD) and run YOLO stock count.
    """
    if nonce:
        frame = capture_with_nonce(host, username, password, nonce)
    else:
        client = ISAPIClient(host=host, user=username, password=password)
        frame = capture_snapshot(client).raw_bytes

    detection = detect_stock(
        frame,
        allowed_categories=allowed_categories,
        allowed_skus=allowed_skus,
    )
    detection["frameBase64"] = None  # filled by API if requested
    detection["frameBytes"] = frame
    detection["nonceBound"] = bool(nonce)
    return detection
