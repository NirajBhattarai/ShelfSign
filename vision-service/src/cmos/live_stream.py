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

from .isapi_client import ISAPIClient

BOUNDARY = "shelfsignframe"


def mjpeg_frames(host: str, username: str, password: str, interval_s: float = 0.5) -> Iterator[bytes]:
    """Yields multipart/x-mixed-replace chunks until the camera errors out
    (unreachable, wrong credentials) or the caller stops iterating (browser
    tab closed -- the ASGI layer stops calling next() once the connection
    drops)."""
    client = ISAPIClient(host=host, user=username, password=password)
    boundary = BOUNDARY.encode()
    while True:
        try:
            frame = client.snapshot_bytes()
        except Exception:
            break
        yield (
            b"--" + boundary + b"\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
            + frame + b"\r\n"
        )
        time.sleep(interval_s)
