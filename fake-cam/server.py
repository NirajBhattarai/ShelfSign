#!/usr/bin/env python3
"""
fake-cam — Hikvision-shaped ISAPI stub for ShelfSign anti-fake demos.

Digest auth without session cookies (matches how real cameras + requests
HTTPDigestAuth / curl --digest behave).

Demo only. Do not use against cameras you do not own.
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Callable, Optional
from xml.sax.saxutils import escape

from flask import Flask, Response, request
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"

HOST = os.environ.get("FAKE_CAM_HOST", "0.0.0.0")
PORT = int(os.environ.get("FAKE_CAM_PORT", "8788"))
USERNAME = os.environ.get("FAKE_CAM_USER", "admin")
PASSWORD = os.environ.get("FAKE_CAM_PASS", "FakeCamDemo1!")
REALM = os.environ.get("FAKE_CAM_REALM", "IP Camera")
STATIC_JPEG = os.environ.get("FAKE_CAM_JPEG", str(FIXTURES / "full_shelf.jpg"))
VIDEO_PATH = os.environ.get("FAKE_CAM_VIDEO", "").strip()
FRAMES_DIR = os.environ.get("FAKE_CAM_FRAMES_DIR", "").strip()


app = Flask(__name__)

_lock = threading.Lock()
_state = {
    "osd_text": "FAKE-CAM",
    "osd_enabled": True,
    "ircut": "day",
    "ir_level": 50,
    "ir_mode": "irLight",
    "brightness": 50,
    "saturation": 50,
    "contrast": 50,
    "frame_n": 0,
}

# nonce → issued_at (reject unknown / stale nonces)
_nonces: dict[str, float] = {}
_nonce_lock = threading.Lock()
_NONCE_TTL_S = 300.0


def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _issue_nonce() -> str:
    nonce = secrets.token_hex(16)
    with _nonce_lock:
        now = time.time()
        expired = [k for k, t in _nonces.items() if now - t > _NONCE_TTL_S]
        for k in expired:
            del _nonces[k]
        _nonces[nonce] = now
    return nonce


def _parse_digest(header: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not header.lower().startswith("digest "):
        return out
    body = header[7:]
    for m in re.finditer(r'(\w+)=(?:"([^"]*)"|([^\s,]+))', body):
        out[m.group(1)] = m.group(2) if m.group(2) is not None else m.group(3)
    return out


def _unauthorized() -> Response:
    nonce = _issue_nonce()
    challenge = (
        f'Digest realm="{REALM}", nonce="{nonce}", '
        f'qop="auth", algorithm=MD5'
    )
    return Response(
        "Unauthorized Access",
        status=401,
        headers={"WWW-Authenticate": challenge},
        mimetype="text/plain",
    )


def require_digest(view: Callable):
    @wraps(view)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.lower().startswith("digest "):
            return _unauthorized()
        params = _parse_digest(header)
        username = params.get("username", "")
        nonce = params.get("nonce", "")
        uri = params.get("uri", "")
        response = params.get("response", "")
        qop = params.get("qop", "")
        nc = params.get("nc", "")
        cnonce = params.get("cnonce", "")

        if username != USERNAME or not nonce or not response:
            return _unauthorized()

        with _nonce_lock:
            issued = _nonces.get(nonce)
            if issued is None or time.time() - issued > _NONCE_TTL_S:
                return _unauthorized()

        ha1 = _md5(f"{USERNAME}:{REALM}:{PASSWORD}")
        # Some clients hash the request path only; others include query.
        ha2 = _md5(f"{request.method}:{uri}")
        if qop == "auth":
            expected = _md5(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}")
        else:
            expected = _md5(f"{ha1}:{nonce}:{ha2}")

        if expected.lower() != response.lower():
            # Retry HA2 with request.full_path quirks
            alt_uri = request.path
            ha2b = _md5(f"{request.method}:{alt_uri}")
            if qop == "auth":
                expected2 = _md5(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2b}")
            else:
                expected2 = _md5(f"{ha1}:{nonce}:{ha2b}")
            if expected2.lower() != response.lower():
                return _unauthorized()

        return view(*args, **kwargs)

    return wrapped


def _font(size: int = 28):
    # Avoid probing system font paths — can hang under threaded servers on macOS.
    return ImageFont.load_default()



def _synthetic_frame(n: int, osd: str) -> bytes:
    w, h = 1280, 720
    img = Image.new("RGB", (w, h), (28, 32, 40))
    draw = ImageDraw.Draw(img)

    for row in range(3):
        y0 = 120 + row * 180
        for col in range(5):
            x0 = 80 + col * 230
            shade = 70 + ((n + row * 3 + col) % 5) * 12
            draw.rectangle(
                [x0, y0, x0 + 200, y0 + 150], fill=(shade, shade - 10, shade - 20)
            )
            draw.rectangle(
                [x0 + 20, y0 + 30, x0 + 180, y0 + 120], outline=(200, 180, 80), width=3
            )
            draw.text(
                (x0 + 40, y0 + 60), f"SKU-{row}{col}", fill=(240, 240, 240), font=_font(22)
            )

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    draw.rectangle([0, 0, w, 56], fill=(180, 40, 40))
    draw.text(
        (16, 12),
        f"FAKE STREAM  frame={n}  {ts}",
        fill=(255, 255, 255),
        font=_font(28),
    )
    if osd:
        draw.rectangle([0, h - 64, w, h], fill=(0, 0, 0))
        draw.text(
            (16, h - 48), f"OSD: {osd[:80]}", fill=(0, 255, 120), font=_font(24)
        )
    draw.text(
        (16, 70),
        "NOT A REAL CMOS SENSOR — ShelfSign should REJECT",
        fill=(255, 200, 80),
        font=_font(22),
    )

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


_video_cap = None
_video_lock = threading.Lock()
_frame_files: list[Path] = []
_frame_bytes: list[bytes] = []


def _burn_banner(jpeg: bytes, text: str) -> bytes:
    """Light overlay; falls back to raw jpeg if Pillow fails."""
    try:
        img = Image.open(io.BytesIO(jpeg)).convert("RGB")
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 0, img.width, 36], fill=(180, 40, 40))
        draw.text((10, 8), text[:90], fill=(255, 255, 255), font=_font(20))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()
    except Exception:
        return jpeg


def _load_frame_dir() -> None:
    global _frame_files, _frame_bytes
    _frame_files = []
    _frame_bytes = []
    path = Path(FRAMES_DIR) if FRAMES_DIR else (FIXTURES / "frames")
    # Re-read env in case import raced setdefault
    env_dir = os.environ.get("FAKE_CAM_FRAMES_DIR", "").strip()
    if env_dir:
        path = Path(env_dir)
    if not path.is_dir():
        print(f"  WARN: frames dir missing: {path}")
        return
    files = sorted(path.glob("frame_*.jpg"))
    if not files:
        files = sorted(path.glob("*.jpg"))
    for f in files:
        try:
            data = f.read_bytes()
            if data[:3] == b"\xff\xd8\xff":
                _frame_files.append(f)
                _frame_bytes.append(data)
        except OSError:
            continue
    print(f"  Preloaded {len(_frame_bytes)} JPEG frames from {path}", flush=True)



def _frame_from_dir() -> Optional[bytes]:
    if not _frame_bytes:
        return None
    with _lock:
        n = _state["frame_n"]
    # Serve raw preloaded JPEG only — no Pillow on the request path
    # (font/render can hang under concurrent Digest+challenge traffic on macOS).
    return _frame_bytes[(n - 1) % len(_frame_bytes)]




def _frame_from_video() -> Optional[bytes]:
    global _video_cap
    if not VIDEO_PATH:
        return None
    try:
        import cv2  # type: ignore
    except ImportError:
        return None

    with _video_lock:
        if _video_cap is None:
            _video_cap = cv2.VideoCapture(VIDEO_PATH)
            if not _video_cap.isOpened():
                _video_cap = None
                return None
        ok, frame = _video_cap.read()
        if not ok:
            _video_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = _video_cap.read()
            if not ok:
                return None
        import cv2 as _cv2

        _cv2.rectangle(frame, (0, 0), (frame.shape[1], 40), (0, 0, 180), -1)
        _cv2.putText(
            frame,
            "FAKE-CAM VIDEO REPLAY",
            (12, 28),
            _cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2,
        )
        ok, enc = _cv2.imencode(".jpg", frame, [int(_cv2.IMWRITE_JPEG_QUALITY), 85])
        return enc.tobytes() if ok else None


def _jpeg_bytes() -> bytes:
    with _lock:
        _state["frame_n"] += 1
        n = _state["frame_n"]
        osd = _state["osd_text"] if _state["osd_enabled"] else ""

    # Prefer pre-extracted frame strip (fast loop of real warehouse footage).
    framed = _frame_from_dir()
    if framed is not None:
        return framed

    if Path(STATIC_JPEG).is_file() and not VIDEO_PATH:
        base = Image.open(STATIC_JPEG).convert("RGB")
        draw = ImageDraw.Draw(base)
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        draw.rectangle([0, 0, base.width, 40], fill=(180, 40, 40))
        draw.text(
            (10, 8),
            f"FAKE-CAM replay frame={n} {ts}",
            fill=(255, 255, 255),
            font=_font(22),
        )
        if osd:
            draw.rectangle([0, base.height - 40, base.width, base.height], fill=(0, 0, 0))
            draw.text(
                (10, base.height - 32),
                f"OSD: {osd[:60]}",
                fill=(0, 255, 120),
                font=_font(18),
            )
        buf = io.BytesIO()
        base.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

    vid = _frame_from_video()
    if vid is not None:
        return vid
    return _synthetic_frame(n, osd)


def _xml(body: str) -> Response:
    return Response(body, mimetype="application/xml")


def _ok_status() -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <statusCode>1</statusCode>
  <statusString>OK</statusString>
  <subStatusCode>ok</subStatusCode>
</ResponseStatus>"""


@app.get("/")
def index():
    return {
        "service": "fake-cam",
        "purpose": "ShelfSign demo: fake Hikvision ISAPI JPEG stream",
        "listen": f"{HOST}:{PORT}",
        "username": USERNAME,
        "password": PASSWORD,
        "snapshot": "/ISAPI/Streaming/channels/101/picture",
        "hint": "Point ShelfSign HIKVISION_HOST at this machine IP:port",
    }


@app.get("/health")
def health():
    return {"status": "ok", "frames": _state["frame_n"]}


@app.get("/ISAPI/System/deviceInfo")
@require_digest
def device_info():
    return _xml(
        """<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <deviceName>ShelfSign-FakeCam</deviceName>
  <deviceID>fake-cam-001</deviceID>
  <model>FAKE-ISAPI-STUB</model>
  <serialNumber>FAKECMOS0000001</serialNumber>
  <firmwareVersion>V0.0.1</firmwareVersion>
  <deviceType>IPCamera</deviceType>
</DeviceInfo>"""
    )


@app.get("/ISAPI/System/capabilities")
@require_digest
def capabilities():
    return _xml(
        """<?xml version="1.0" encoding="UTF-8"?>
<DeviceCap version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <isSupportStreaming>true</isSupportStreaming>
</DeviceCap>"""
    )


@app.get("/ISAPI/Streaming/channels/<int:channel>/picture")
@require_digest
def picture(channel: int):
    return Response(_jpeg_bytes(), mimetype="image/jpeg")


@app.get("/ISAPI/ContentMgmt/StreamingProxy/channels/<int:channel>/picture")
@require_digest
def picture_proxy(channel: int):
    return Response(_jpeg_bytes(), mimetype="image/jpeg")


OSD_PATH = "/ISAPI/System/Video/inputs/channels/1/overlays/text/1"
IRCUT_PATH = "/ISAPI/Image/channels/1/ircutFilter"
LIGHT_PATH = "/ISAPI/Image/channels/1/supplementLight"
COLOR_PATH = "/ISAPI/Image/channels/1/color"


@app.route(OSD_PATH, methods=["GET", "PUT"])
@require_digest
def osd_text():
    if request.method == "GET":
        with _lock:
            text = escape(_state["osd_text"])
            enabled = "true" if _state["osd_enabled"] else "false"
        return _xml(
            f"""<?xml version="1.0" encoding="UTF-8"?>
<TextOverlay version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <id>1</id>
  <enabled>{enabled}</enabled>
  <positionX>0</positionX>
  <positionY>576</positionY>
  <displayText>{text}</displayText>
  <isPersistentText>true</isPersistentText>
</TextOverlay>"""
        )
    body = request.get_data(as_text=True) or ""
    m = re.search(r"<displayText>(.*?)</displayText>", body, re.S)
    e = re.search(r"<enabled>(.*?)</enabled>", body, re.S)
    with _lock:
        if m:
            _state["osd_text"] = m.group(1).strip()
        if e:
            _state["osd_enabled"] = e.group(1).strip().lower() == "true"
    return _xml(_ok_status())


@app.route(IRCUT_PATH, methods=["GET", "PUT"])
@require_digest
def ircut():
    if request.method == "GET":
        with _lock:
            mode = _state["ircut"]
        return _xml(
            f"""<?xml version="1.0" encoding="UTF-8"?>
<IrcutFilter version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <IrcutFilterType>{mode}</IrcutFilterType>
</IrcutFilter>"""
        )
    body = request.get_data(as_text=True) or ""
    m = re.search(r"<IrcutFilterType>(.*?)</IrcutFilterType>", body)
    with _lock:
        if m:
            _state["ircut"] = m.group(1).strip()
    return _xml(_ok_status())


@app.route(LIGHT_PATH, methods=["GET", "PUT"])
@require_digest
def supplement_light():
    if request.method == "GET":
        with _lock:
            level, mode = _state["ir_level"], _state["ir_mode"]
        return _xml(
            f"""<?xml version="1.0" encoding="UTF-8"?>
<SupplementLight version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <supplementLightMode>{mode}</supplementLightMode>
  <irLightBrightness>{level}</irLightBrightness>
</SupplementLight>"""
        )
    body = request.get_data(as_text=True) or ""
    m = re.search(r"<irLightBrightness>(.*?)</irLightBrightness>", body)
    mode = re.search(r"<supplementLightMode>(.*?)</supplementLightMode>", body)
    with _lock:
        if m:
            _state["ir_level"] = int(m.group(1).strip())
        if mode:
            _state["ir_mode"] = mode.group(1).strip()
    return _xml(_ok_status())


@app.route(COLOR_PATH, methods=["GET", "PUT"])
@require_digest
def color():
    if request.method == "GET":
        with _lock:
            b, s, c = _state["brightness"], _state["saturation"], _state["contrast"]
        return _xml(
            f"""<?xml version="1.0" encoding="UTF-8"?>
<Color version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <brightnessLevel>{b}</brightnessLevel>
  <contrastLevel>{c}</contrastLevel>
  <saturationLevel>{s}</saturationLevel>
</Color>"""
        )
    body = request.get_data(as_text=True) or ""
    with _lock:
        for key, tag in (
            ("brightness", "brightnessLevel"),
            ("contrast", "contrastLevel"),
            ("saturation", "saturationLevel"),
        ):
            m = re.search(rf"<{tag}>(.*?)</{tag}>", body)
            if m:
                _state[key] = int(m.group(1).strip())
    return _xml(_ok_status())


def _ensure_fixture() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)


def main() -> None:
    _ensure_fixture()
    _load_frame_dir()
    lan = "127.0.0.1"
    try:
        import socket

        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan = s.getsockname()[0]
        s.close()
    except OSError:
        pass

    print("=" * 60)
    print("fake-cam  (ShelfSign demo — NOT a real CMOS camera)")
    print("=" * 60)
    print(f"  Listen:   http://{HOST}:{PORT}")
    print(f"  LAN IP:   {lan}")
    print(f"  Username: {USERNAME}")
    print(f"  Password: {PASSWORD}")
    print(f"  Snapshot: http://{lan}:{PORT}/ISAPI/Streaming/channels/101/picture")
    if _frame_bytes:
        print(f"  Video:    looping {_frame_files[0].parent} ({len(_frame_bytes)} frames)")
    elif VIDEO_PATH:
        print(f"  Video:    {VIDEO_PATH}")
    print()
    print("  Point ShelfSign camera host to:")
    print(f"    {lan}:{PORT}")
    print("  (or 127.0.0.1:8788 if vision runs on this machine)")
    print("=" * 60)

    app.run(host=HOST, port=PORT, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
