"""
Digest-auth ISAPI HTTP client for Hikvision cameras.

Ported from the siliconwitness project (/Users/niraj/Desktop/siliconwitness/
gateway/isapi/client.py), which validated this live against a Hikvision
DS-2CD1323G0E-I (firmware V5.7.23). Unlike that project — which talks to one
hardcoded camera via env vars — every ShelfSign supplier can register many
cameras, so host/user/password come from the `cameras` table per request
instead of a single .env.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

import requests
from requests.auth import HTTPDigestAuth


class ISAPIError(RuntimeError):
    def __init__(self, method: str, url: str, status_code: int, body: str):
        self.method = method
        self.url = url
        self.status_code = status_code
        self.body = body
        super().__init__(f"{method} {url} -> {status_code}: {body[:300]}")


@dataclass
class ISAPIResponse:
    status_code: int
    text: str
    content: bytes
    elapsed_s: float
    ok: bool


class ISAPIClient:
    """Minimal digest-auth ISAPI client.

    Usage:
        client = ISAPIClient(host="192.168.50.64", user="admin", password="...")
        resp = client.get("/ISAPI/System/capabilities")
    """

    def __init__(
        self,
        host: str,
        user: Optional[str] = None,
        password: str = "",
        scheme: str = "http",
        timeout: float = 10.0,
        channel: int = 101,
        username: Optional[str] = None,
    ):
        # Accept both `user` (SiliconWitness) and `username` (HTTP callers).
        resolved_user = user or username
        if not host or not resolved_user or not password:
            raise ValueError("host, user/username, and password are all required")
        self.host = host
        self.scheme = scheme
        self.timeout = timeout
        self.channel = channel
        self._auth = HTTPDigestAuth(resolved_user, password)
        self._session = requests.Session()

    @property
    def base_url(self) -> str:
        return f"{self.scheme}://{self.host}"

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return self.base_url + path

    def get(self, path: str, **kwargs) -> ISAPIResponse:
        url = self._url(path)
        t0 = time.monotonic()
        r = self._session.get(url, auth=self._auth, timeout=self.timeout, **kwargs)
        elapsed = time.monotonic() - t0
        return ISAPIResponse(
            status_code=r.status_code,
            text=r.text if not kwargs.get("stream") else "",
            content=r.content if not kwargs.get("stream") else b"",
            elapsed_s=elapsed,
            ok=r.ok,
        )

    def put(
        self, path: str, data: Optional[str] = None, headers: Optional[dict] = None
    ) -> ISAPIResponse:
        url = self._url(path)
        hdrs = {"Content-Type": "application/xml"}
        if headers:
            hdrs.update(headers)
        t0 = time.monotonic()
        r = self._session.put(
            url, auth=self._auth, data=data, headers=hdrs, timeout=self.timeout
        )
        elapsed = time.monotonic() - t0
        return ISAPIResponse(
            status_code=r.status_code,
            text=r.text,
            content=r.content,
            elapsed_s=elapsed,
            ok=r.ok,
        )

    def get_xml(self, path: str) -> str:
        r = self.get(path)
        if not r.ok:
            raise ISAPIError("GET", path, r.status_code, r.text)
        return r.text

    def put_xml(self, path: str, body: str) -> ISAPIResponse:
        r = self.put(path, data=body)
        if not r.ok:
            raise ISAPIError("PUT", path, r.status_code, r.text)
        return r

    # --- Snapshot -----------------------------------------------------
    def snapshot_bytes(self, channel: Optional[int] = None) -> bytes:
        """Fetch a single JPEG still from /ISAPI/Streaming/channels/<ch>/picture
        -- the ONLY capture path used for fingerprinting, never the
        H.264/H.265 video stream (PRNU-style analysis needs the sensor's own
        still-image pipeline, not a re-encoded video frame).

        Retries on HTTP 503 / deviceBusy — common when a live MJPEG preview is
        also polling the same endpoint.
        """
        from .camera_gate import camera_snapshot_lock

        ch = channel or self.channel
        path = f"/ISAPI/Streaming/channels/{ch}/picture"
        attempts = 8
        last_err: Optional[ISAPIError] = None
        with camera_snapshot_lock():
            for i in range(attempts):
                r = self.get(path)
                if r.ok:
                    return r.content
                last_err = ISAPIError("GET", path, r.status_code, r.text)
                busy = r.status_code == 503 or "deviceBusy" in (r.text or "")
                if not busy or i == attempts - 1:
                    raise last_err
                # Back off: 0.4s, 0.8s, 1.2s, … capped at 2.5s
                time.sleep(min(2.5, 0.4 * (i + 1)))
        assert last_err is not None
        raise last_err
