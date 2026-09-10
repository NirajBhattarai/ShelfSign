#!/usr/bin/env python3
"""Minimal fake Hikvision ISAPI camera — stdlib only (no Flask/Pillow on request path)."""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
HOST = os.environ.get("FAKE_CAM_HOST", "0.0.0.0")
PORT = int(os.environ.get("FAKE_CAM_PORT", "8788"))
USERNAME = os.environ.get("FAKE_CAM_USER", "admin")
PASSWORD = os.environ.get("FAKE_CAM_PASS", "FakeCamDemo1!")
REALM = os.environ.get("FAKE_CAM_REALM", "IP Camera")
FRAMES_DIR = Path(
    os.environ.get("FAKE_CAM_FRAMES_DIR", str(FIXTURES / "frames"))
)

_frame_bytes: list[bytes] = []
_frame_n = 0
_frame_lock = threading.Lock()
# Which video frame is "current" advances on a wall-clock schedule, not once
# per request. Advancing per-request meant every single snapshot in a burst
# (enroll's 12 captures, challenge's 3-sample majority vote) saw genuinely
# different video content -- fine for a live-preview aesthetic, but it broke
# the pixel-stability PUF's core assumption that a static aisle looks nearly
# identical between captures a fraction of a second apart, causing spurious
# BCH regeneration mismatches even against this camera's own enrollment.
# Preview advances every ~0.4s for a snappier live view. Fake Cam cannot
# enroll (synthetic device gate), so we no longer need the old 4s hold that
# only existed to keep PUF bursts seeing near-identical frames.
FRAME_ADVANCE_INTERVAL_S = float(os.environ.get("FAKE_CAM_FRAME_INTERVAL_S", "0.4"))
_state = {
    "osd_text": "FAKE-CAM",
    "osd_enabled": True,
    "ircut": "day",
    "ir_level": 50,
    "ir_mode": "irLight",
    "brightness": 50,
    "saturation": 50,
    "contrast": 50,
}
_state_lock = threading.Lock()
_nonces: dict[str, float] = {}
_nonce_lock = threading.Lock()
_NONCE_TTL_S = 300.0


def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _load_frames() -> None:
    global _frame_bytes
    files = sorted(FRAMES_DIR.glob("frame_*.jpg"))
    if not files:
        files = sorted(FRAMES_DIR.glob("*.jpg"))
    out: list[bytes] = []
    for f in files:
        try:
            data = f.read_bytes()
            if data[:3] == b"\xff\xd8\xff":
                out.append(data)
        except OSError:
            continue
    _frame_bytes = out
    print(f"  Preloaded {len(_frame_bytes)} JPEG frames from {FRAMES_DIR}", flush=True)


def _next_jpeg() -> bytes:
    global _frame_n
    if not _frame_bytes:
        # Tiny valid JPEG (1x1) — never block on Pillow
        return (
            b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
            b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e"
            b"\x1d\x1a\x1c\x1c $.\' \",#\x1c\x1c(7),01444\x1f\'9=82<.342"
            b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
            b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00"
            b"\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
            b"\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04"
            b"\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07\"q"
            b"\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82"
            b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xaa\xff\xd9"
        )
    with _frame_lock:
        _frame_n += 1  # cumulative request count, exposed via /health only
    frame_idx = int(time.time() / FRAME_ADVANCE_INTERVAL_S) % len(_frame_bytes)
    return _frame_bytes[frame_idx]


def _issue_nonce() -> str:
    nonce = secrets.token_hex(16)
    with _nonce_lock:
        now = time.time()
        for k, t in list(_nonces.items()):
            if now - t > _NONCE_TTL_S:
                del _nonces[k]
        _nonces[nonce] = now
    return nonce


def _parse_digest(header: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not header.lower().startswith("digest "):
        return out
    for m in re.finditer(r'(\w+)=(?:"([^"]*)"|([^\s,]+))', header[7:]):
        out[m.group(1)] = m.group(2) if m.group(2) is not None else m.group(3)
    return out


def _check_digest(method: str, path: str, header: str) -> bool:
    if not header.lower().startswith("digest "):
        return False
    params = _parse_digest(header)
    username = params.get("username", "")
    nonce = params.get("nonce", "")
    uri = params.get("uri", "")
    response = params.get("response", "")
    qop = params.get("qop", "")
    nc = params.get("nc", "")
    cnonce = params.get("cnonce", "")
    if username != USERNAME or not nonce or not response:
        return False
    with _nonce_lock:
        issued = _nonces.get(nonce)
        if issued is None or time.time() - issued > _NONCE_TTL_S:
            return False
    ha1 = _md5(f"{USERNAME}:{REALM}:{PASSWORD}")

    def expected_for(u: str) -> str:
        ha2 = _md5(f"{method}:{u}")
        if qop == "auth":
            return _md5(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}")
        return _md5(f"{ha1}:{nonce}:{ha2}")

    candidates = {uri, path, urlparse(uri).path}
    return any(expected_for(u).lower() == response.lower() for u in candidates if u)


def _ok_status() -> bytes:
    return b"""<?xml version="1.0" encoding="UTF-8"?>
<ResponseStatus version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <statusCode>1</statusCode>
  <statusString>OK</statusString>
  <subStatusCode>ok</subStatusCode>
</ResponseStatus>"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"  {self.address_string()} {fmt % args}", flush=True)

    def _send(self, code: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _unauthorized(self) -> None:
        nonce = _issue_nonce()
        challenge = f'Digest realm="{REALM}", nonce="{nonce}", qop="auth", algorithm=MD5'
        self._send(
            401,
            b"Unauthorized Access",
            "text/plain",
            {"WWW-Authenticate": challenge},
        )

    def _require_auth(self) -> bool:
        auth = self.headers.get("Authorization", "")
        path = urlparse(self.path).path
        if _check_digest(self.command, path, auth):
            return True
        self._unauthorized()
        return False

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", "/health"):
            with _frame_lock:
                n = _frame_n
            body = (
                f'{{"status":"ok","service":"fake-cam","frames_served":{n},'
                f'"preloaded":{len(_frame_bytes)}}}'
            ).encode()
            self._send(200, body, "application/json")
            return

        if not self._require_auth():
            return

        if re.fullmatch(r"/ISAPI/Streaming/channels/\d+/picture", path) or re.fullmatch(
            r"/ISAPI/ContentMgmt/StreamingProxy/channels/\d+/picture", path
        ):
            self._send(200, _next_jpeg(), "image/jpeg")
            return

        if path == "/ISAPI/System/deviceInfo":
            self._send(
                200,
                b"""<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <deviceName>ShelfSign-FakeCam</deviceName>
  <deviceID>fake-cam-001</deviceID>
  <model>FAKE-ISAPI-STUB</model>
  <serialNumber>FAKECMOS0000001</serialNumber>
  <firmwareVersion>V0.0.1</firmwareVersion>
  <deviceType>IPCamera</deviceType>
</DeviceInfo>""",
                "application/xml",
            )
            return

        if path == "/ISAPI/System/capabilities":
            self._send(
                200,
                b"""<?xml version="1.0" encoding="UTF-8"?>
<DeviceCap version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <isSupportStreaming>true</isSupportStreaming>
</DeviceCap>""",
                "application/xml",
            )
            return

        if path == "/ISAPI/System/Video/inputs/channels/1/overlays/text/1":
            with _state_lock:
                text = _state["osd_text"]
                enabled = "true" if _state["osd_enabled"] else "false"
            body = f"""<?xml version="1.0" encoding="UTF-8"?>
<TextOverlay version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <id>1</id>
  <enabled>{enabled}</enabled>
  <positionX>0</positionX>
  <positionY>576</positionY>
  <displayText>{text}</displayText>
  <isPersistentText>true</isPersistentText>
</TextOverlay>""".encode()
            self._send(200, body, "application/xml")
            return

        if path == "/ISAPI/Image/channels/1/ircutFilter":
            with _state_lock:
                mode = _state["ircut"]
            body = f"""<?xml version="1.0" encoding="UTF-8"?>
<IrcutFilter version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <IrcutFilterType>{mode}</IrcutFilterType>
</IrcutFilter>""".encode()
            self._send(200, body, "application/xml")
            return

        if path == "/ISAPI/Image/channels/1/supplementLight":
            with _state_lock:
                level, mode = _state["ir_level"], _state["ir_mode"]
            body = f"""<?xml version="1.0" encoding="UTF-8"?>
<SupplementLight version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <supplementLightMode>{mode}</supplementLightMode>
  <irLightBrightness>{level}</irLightBrightness>
</SupplementLight>""".encode()
            self._send(200, body, "application/xml")
            return

        if path == "/ISAPI/Image/channels/1/color":
            with _state_lock:
                b, s, c = _state["brightness"], _state["saturation"], _state["contrast"]
            body = f"""<?xml version="1.0" encoding="UTF-8"?>
<Color version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <brightnessLevel>{b}</brightnessLevel>
  <contrastLevel>{c}</contrastLevel>
  <saturationLevel>{s}</saturationLevel>
</Color>""".encode()
            self._send(200, body, "application/xml")
            return

        self._send(404, b"not found", "text/plain")

    def do_PUT(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace") if length else ""
        if not self._require_auth():
            return

        with _state_lock:
            if path == "/ISAPI/System/Video/inputs/channels/1/overlays/text/1":
                m = re.search(r"<displayText>(.*?)</displayText>", body, re.S)
                e = re.search(r"<enabled>(.*?)</enabled>", body, re.S)
                if m:
                    _state["osd_text"] = m.group(1).strip()
                if e:
                    _state["osd_enabled"] = e.group(1).strip().lower() == "true"
            elif path == "/ISAPI/Image/channels/1/ircutFilter":
                m = re.search(r"<IrcutFilterType>(.*?)</IrcutFilterType>", body)
                if m:
                    _state["ircut"] = m.group(1).strip()
            elif path == "/ISAPI/Image/channels/1/supplementLight":
                m = re.search(r"<irLightBrightness>(.*?)</irLightBrightness>", body)
                mode = re.search(r"<supplementLightMode>(.*?)</supplementLightMode>", body)
                if m:
                    _state["ir_level"] = int(m.group(1).strip())
                if mode:
                    _state["ir_mode"] = mode.group(1).strip()
            elif path == "/ISAPI/Image/channels/1/color":
                for key, tag in (
                    ("brightness", "brightnessLevel"),
                    ("contrast", "contrastLevel"),
                    ("saturation", "saturationLevel"),
                ):
                    m = re.search(rf"<{tag}>(.*?)</{tag}>", body)
                    if m:
                        _state[key] = int(m.group(1).strip())
            else:
                self._send(404, b"not found", "text/plain")
                return
        self._send(200, _ok_status(), "application/xml")


def main() -> None:
    _load_frames()
    if not _frame_bytes:
        raise SystemExit(f"No JPEG frames in {FRAMES_DIR}")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 60, flush=True)
    print("fake-cam (stdlib ThreadingHTTPServer)", flush=True)
    print(f"  http://127.0.0.1:{PORT}", flush=True)
    print(f"  user={USERNAME} pass={PASSWORD}", flush=True)
    print(f"  preloaded={len(_frame_bytes)}", flush=True)
    print("=" * 60, flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
