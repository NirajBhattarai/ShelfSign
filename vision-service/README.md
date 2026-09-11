---
title: ShelfSign Vision Service
emoji: 📷
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

ShelfSign vision service: YOLO stock detection + CMOS/PRNU camera fingerprinting, exposed via FastAPI.

- `GET /health` — liveness check
- `POST /vision/detect` — stock detection from a frame
- `POST /cmos/*` — camera enrollment / PUF challenge-response

Runs on CPU. Talks to a Hikvision camera over the LAN when `host`/`username`/`password`
are supplied per-request — those camera routes are unreachable from this cloud Space
unless the camera is exposed to the internet or reached through a tunnel/VPN.
