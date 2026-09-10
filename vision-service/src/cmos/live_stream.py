"""
Near-live view for a supplier watching their own camera. This is NOT a real
video stream (no H.264 decode/transcode) -- it reuses the exact same JPEG
snapshot endpoint enrollment uses (isapi_client.snapshot_bytes), polled a
few times a second and relayed to the browser as a standard MJPEG
multipart response, which every browser renders natively from a plain
<img src="..."> with no player library needed.
"""
from __future__ import annotations

import time
from typing import Iterator

from .isapi_client import ISAPIClient, ISAPIError

BOUNDARY = "shelfsignframe"

# Real Hikvision still-JPEG hates aggressive polling (HTTP 503 deviceBusy).
# Local fake-cam / loopback hosts can run much faster for a snappier preview.
_REAL_INTERVAL_S = 0.75
_LOCAL_INTERVAL_S = 0.12


def _stream_interval_s(host: str) -> float:
    h = (host or "").strip().lower()
    if h.startswith("127.0.0.1") or h.startswith("localhost") or h.startswith("0.0.0.0"):
        return _LOCAL_INTERVAL_S
    return _REAL_INTERVAL_S


def mjpeg_frames(
    host: str,
    username: str,
    password: str,
    interval_s: float | None = None,
) -> Iterator[bytes]:
    """Yields multipart/x-mixed-replace chunks.

    Snapshot locking is handled inside ISAPIClient.snapshot_bytes (per-host),
    so this loop does not take an outer lock — that previously double-locked
    and let one unreachable camera stall every other stream.
    """
    if interval_s is None:
        interval_s = _stream_interval_s(host)
    # Short connect/read timeout so a dead host fails fast instead of
    # holding the per-host lock for the default 10s ISAPI timeout.
    client = ISAPIClient(
        host=host,
        user=username,
        password=password,
        timeout=2.5,
    )
    boundary = BOUNDARY.encode()
    fail_streak = 0
    while True:
        try:
            frame = client.snapshot_bytes()
            fail_streak = 0
        except Exception:
            fail_streak += 1
            # Keep the MJPEG connection alive through brief deviceBusy /
            # network blips; back off harder when the camera is gone.
            time.sleep(min(5.0, max(interval_s, 0.5 * fail_streak)))
            if fail_streak >= 40:
                # After ~long outage, end the generator so the proxy can
                # close rather than serving an eternal blank 200.
                raise ISAPIError(
                    "GET",
                    "/ISAPI/Streaming/channels/101/picture",
                    504,
                    "camera_unreachable",
                )
            continue
        yield (
            b"--" + boundary + b"\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
            + frame + b"\r\n"
        )
        time.sleep(interval_s)
