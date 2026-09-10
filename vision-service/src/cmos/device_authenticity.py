"""Detect synthetic / stub cameras that mimic Hikvision ISAPI.

Real ShelfSign trust requires a physical CMOS sensor. Our own fake-cam
stub advertises serial/model markers (FAKECMOS…, FAKE-ISAPI-STUB) and
serves a small looping JPEG set that never burns OSD into the frame.
Those signals must fail enroll + challenge — self-consistent PUF replay
is not proof of a real sensor.
"""

from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from typing import Optional

from .isapi_client import ISAPIClient, ISAPIError

# Substrings that identify the ShelfSign ISAPI stub (and obvious clones).
_FAKE_MARKERS = (
    "FAKE",
    "STUB",
    "SIMULATOR",
    "MOCK",
    "SHELFSIGN-FAKE",
)


class SyntheticDeviceError(ValueError):
    """Raised when deviceInfo / capture evidence shows a non-physical camera."""


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def parse_device_info_xml(xml_text: str) -> dict:
    """Pull common DeviceInfo fields from Hikvision XML (namespaces ignored)."""
    out: dict = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    wanted = {
        "deviceName",
        "deviceID",
        "model",
        "serialNumber",
        "firmwareVersion",
        "deviceType",
    }
    for el in root.iter():
        key = _local(el.tag)
        if key in wanted and el.text and key not in out:
            out[key] = el.text.strip()
    return out


def fetch_device_info(client: ISAPIClient) -> dict:
    r = client.get("/ISAPI/System/deviceInfo")
    if not r.ok:
        raise ISAPIError("GET", "/ISAPI/System/deviceInfo", r.status_code, r.text)
    return parse_device_info_xml(r.text)


def _looks_fake_token(value: str) -> bool:
    u = (value or "").upper()
    return any(m in u for m in _FAKE_MARKERS)


def device_looks_synthetic(info: dict) -> bool:
    """Pure check used by assert_physical_device and unit tests."""
    serial = info.get("serialNumber") or ""
    model = info.get("model") or ""
    name = info.get("deviceName") or ""
    device_id = info.get("deviceID") or ""
    if any(_looks_fake_token(v) for v in (serial, model, name, device_id)):
        return True
    if not str(serial).strip():
        return True
    return False


def assert_physical_device(client: ISAPIClient) -> dict:
    """Reject known synthetic deviceInfo. Returns parsed info on success."""
    info = fetch_device_info(client)
    if device_looks_synthetic(info):
        raise SyntheticDeviceError(
            "synthetic_device_rejected:"
            f"serial={info.get('serialNumber')!r} model={info.get('model')!r} "
            f"deviceName={info.get('deviceName')!r}"
        )
    return info


def assert_live_sensor_burst(raw_jpegs: list[bytes], *, min_unique_ratio: float = 0.5) -> None:
    """Reject enroll bursts that are mostly identical JPEG replays.

    A live CMOS stream has sensor noise + compression drift so consecutive
    stills are almost never byte-identical. A fixture loop reuses a handful
    of exact files — unique SHA-256 count stays far below capture count.
    """
    if len(raw_jpegs) < 4:
        return
    digests = [hashlib.sha256(b).hexdigest() for b in raw_jpegs if b]
    unique = len(set(digests))
    ratio = unique / max(len(digests), 1)
    if ratio < min_unique_ratio:
        raise SyntheticDeviceError(
            "synthetic_replay_rejected:"
            f"unique_frames={unique}/{len(digests)} ratio={ratio:.3f}"
        )


def osd_region_changed(
    before: "object",
    after: "object",
    box: tuple[int, int, int, int],
    *,
    # Real Hikvision glyph updates measured ~1.7–8 mean abs diff in the OSD
    # crop; the ISAPI stub stays ~0–0.2 (no burn-in). 1.0 separates them
    # without false-failing the physical camera.
    min_mean_abs_diff: float = 1.0,
) -> bool:
    """True when the OSD crop differs enough to suggest burned-in overlay text."""
    import numpy as np

    x0, y0, x1, y1 = box
    a = np.asarray(before)
    b = np.asarray(after)
    if a.ndim == 3:
        a = a[:, :, 0]
    if b.ndim == 3:
        b = b[:, :, 0]
    ha, wa = a.shape[:2]
    hb, wb = b.shape[:2]
    x1a, y1a = min(x1, wa), min(y1, ha)
    x1b, y1b = min(x1, wb), min(y1, hb)
    if x1a <= x0 or y1a <= y0 or x1b <= x0 or y1b <= y0:
        return False
    crop_a = a[y0:y1a, x0:x1a].astype(np.float32)
    crop_b = b[y0:y1b, x0:x1b].astype(np.float32)
    # Align shapes if slightly different crops
    h = min(crop_a.shape[0], crop_b.shape[0])
    w = min(crop_a.shape[1], crop_b.shape[1])
    diff = float(np.mean(np.abs(crop_a[:h, :w] - crop_b[:h, :w])))
    return diff >= min_mean_abs_diff
