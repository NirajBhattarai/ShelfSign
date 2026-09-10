"""Serialize snapshot access per camera host.

The DS-2CD still-JPEG endpoint returns HTTP 503 deviceBusy when multiple
clients poll the same camera at once (live preview + enrollment burst).
Locks are per-host so an unreachable Hikvision cannot starve a local
fake-cam (or any other camera) on a different host.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Dict, Iterator

_LOCKS: Dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(host: str) -> threading.RLock:
    key = (host or "_global_").strip().lower() or "_global_"
    with _LOCKS_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[key] = lock
        return lock


@contextmanager
def camera_snapshot_lock(
    host: str = "",
    timeout_s: float = 90.0,
) -> Iterator[None]:
    """Hold exclusive access to one camera's snapshot pipeline."""
    lock = _lock_for(host)
    acquired = lock.acquire(timeout=timeout_s)
    if not acquired:
        raise TimeoutError("camera_snapshot_busy")
    try:
        yield
    finally:
        lock.release()
