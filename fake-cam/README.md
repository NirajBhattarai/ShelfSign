# fake-cam

**Demo-only** Hikvision-shaped ISAPI camera stub for ShelfSign.

Serves digest-auth JPEG snapshots that look like a live aisle feed but are **not** from an enrolled CMOS sensor. Point ShelfSign at this host, run attest, and the challenge/CMOS path should **reject** the fake stream.

Do not use this against cameras or networks you do not own.

## Credentials (defaults)

| Field | Value |
|-------|--------|
| **IP / host** | `127.0.0.1` (same machine) or your LAN IP printed at startup |
| **Port** | `8788` |
| **Username** | `admin` |
| **Password** | `FakeCamDemo1!` |
| **Snapshot URL** | `http://<host>:8788/ISAPI/Streaming/channels/101/picture` |

ShelfSign camera host field should be set to:

```text
127.0.0.1:8788
```

(or `192.168.x.x:8788` if the vision service runs on another machine).

## Run

Prefer the stdlib server (stable under concurrent Digest + CMOS challenge traffic):

```bash
cd fake-cam
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# extract frames first if fixtures/frames is empty (see below)
python start_waitress.py
# or: python stdlib_server.py
```

`server.py` is the older Flask/waitress path; use it only for debugging.

Optional env:

```bash
export FAKE_CAM_PORT=8788
export FAKE_CAM_USER=admin
export FAKE_CAM_PASS='FakeCamDemo1!'
# Optional: loop a real MP4 as the fake feed (needs OpenCV)
# export FAKE_CAM_VIDEO=/path/to/shelf.mp4
python server.py
```

## Verify

```bash
curl -s --digest -u 'admin:FakeCamDemo1!' \
  -o /tmp/fake-cam.jpg \
  http://127.0.0.1:8788/ISAPI/Streaming/channels/101/picture
file /tmp/fake-cam.jpg
open /tmp/fake-cam.jpg   # macOS
```

Live poll (same path ShelfSign’s preview uses):

```bash
while true; do
  curl -s --digest -u 'admin:FakeCamDemo1!' \
    -o /tmp/fake-cam.jpg \
    http://127.0.0.1:8788/ISAPI/Streaming/channels/101/picture
  sleep 0.3
done
```

## Wire into ShelfSign

1. Enroll + attest once on the **real** Hikvision (honest CMOS account).
2. Start `fake-cam`.
3. In supplier camera settings / `system_settings` / `HIKVISION_HOST`, set host to `127.0.0.1:8788` with user `admin` and password `FakeCamDemo1!`.
4. Run attest again → expect **challenge / CMOS fail** (fake detected).

## What it stubs

- Digest auth (`realm=IP Camera`)
- `GET /ISAPI/Streaming/channels/{101|1|102}/picture`
- `GET /ISAPI/System/deviceInfo`
- OSD / ircut / supplementLight / color GET+PUT XML (enough for SiliconWitness challenge actuators)

## Not included

- Real H.264 RTSP (ShelfSign fingerprinting uses ISAPI JPEG, not RTSP)
- Real CMOS / PRNU noise from a sensor

## Looping warehouse video

Default demo uses the YouTube warehouse clip (`fixtures/youtube_warehouse.mp4`)
extracted to `fixtures/frames/`:

```bash
FAKE_CAM_FRAMES_DIR=./fixtures/frames python start_waitress.py
```
