"""Serialize Hikvision snapshot access across enroll / challenge / MJPEG.

The DS-2CD still-JPEG endpoint returns HTTP 503 deviceBusy when multiple
clients poll /ISAPI/Streaming/channels/101/picture at once (live preview +
enrollment burst). One process-wide lock keeps captures cooperative.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Iterator

_LOCK = threading.RLock()


@contextmanager
def camera_snapshot_lock(timeout_s: float = 90.0) -> Iterator[None]:
    """Hold exclusive access to the camera snapshot pipeline."""
    acquired = _LOCK.acquire(timeout=timeout_s)
    if not acquired:
        raise TimeoutError("camera_snapshot_busy")
    try:
        yield
    finally:
        _LOCK.release()
