"""
JPEG still capture from the Hikvision snapshot endpoint.

Ported from siliconwitness's gateway/sensor/capture.py. Hard constraint
carried over: fingerprinting uses ONLY the JPEG snapshot endpoint, never the
video stream (PRNU-style residual extraction needs the sensor's own still
pipeline, not a re-encoded video frame).
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass

import numpy as np
from PIL import Image

from .isapi_client import ISAPIClient


@dataclass
class Capture:
    image: Image.Image
    array: np.ndarray  # grayscale float32, HxW
    raw_bytes: bytes
    timestamp: float
    fetch_latency_s: float


def capture_snapshot(client: ISAPIClient, channel: int = 101) -> Capture:
    t0 = time.monotonic()
    data = client.snapshot_bytes(channel=channel)
    fetch_latency = time.monotonic() - t0
    ts = time.time()
    img = Image.open(io.BytesIO(data))
    img.load()
    gray = np.asarray(img.convert("L"), dtype=np.float32)
    return Capture(
        image=img,
        array=gray,
        raw_bytes=data,
        timestamp=ts,
        fetch_latency_s=fetch_latency,
    )


def mean_luminance(cap: Capture) -> float:
    """Mean grayscale luminance of the capture (SiliconWitness challenge measure)."""
    return float(cap.array.mean())


def saturation_variance(cap: Capture) -> float:
    """Variance of HSV saturation -- collapses to ~0 in night/mono mode, used
    to confirm the IR-cut switch actually took effect."""
    hsv = np.asarray(cap.image.convert("HSV"), dtype=np.float32)
    s = hsv[:, :, 1]
    return float(s.var())
