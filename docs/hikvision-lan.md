# Hikvision LAN — reachability fix

Use this when the **real** Hikvision (`192.168.50.64`) stops streaming / pinging even though it worked before, while other cameras on `192.168.100.x` still show up.

## Symptom

- ShelfSign “Real Hikvision” preview / attest fails (timeouts).
- `ping 192.168.50.64` → 100% loss.
- Ports `80` / `554` / `8000` closed; **no ARP** entry for `50.64`.
- Mac is on `192.168.100.x` (or another subnet), **not** on `192.168.50.x`.
- Entire `192.168.50.0/24` looks empty — not just `.64`.
- Traceroute to `50.64` goes via the gateway into the ISP path (not a local hop).

This is a **LAN / IP path** problem, not ShelfSign auth or CMOS.

## Why it happens

The camera is addressed at `192.168.50.64` on a separate L2 segment (or dual-homed switch port).

This Mac’s primary address is often `192.168.100.x`. Without a local `192.168.50.x` address, traffic to `50.64` is sent to the default gateway, which does **not** route back onto the camera LAN. Yesterday’s working session usually had either:

- the Mac already on `50.x`, or
- a temporary **alias** `192.168.50.10` on `en0` (same physical link as the camera).

The alias can disappear after reboot, sleep, or network change.

## Quick diagnosis

```bash
# Where is this Mac?
ifconfig en0 | awk '/inet /{print}'

# Can we see the camera?
ping -c 2 -W 1000 192.168.50.64
arp -n 192.168.50.64
nc -z -G 2 192.168.50.64 80 && echo open || echo closed

# Same physical LAN as 100.x cameras?
# (optional) count Hikvisions on current subnet — if these work, app/LAN is fine
```

| Check | Bad (broken) | Good (fixed) |
|-------|----------------|--------------|
| Mac has `192.168.50.x` | no | yes (e.g. alias `.10`) |
| Ping `50.64` | loss | replies |
| ARP `50.64` | no entry | MAC present |
| TCP `50.64:80` | timeout | open |
| ISAPI digest login | connect error | HTTP 200 |

## Fix (macOS) — add `50.x` alias

Requires admin password (same approach used in the lab):

```bash
# Add alias so the Mac can talk L2 to the camera subnet
osascript -e 'do shell script "ifconfig en0 alias 192.168.50.10 netmask 255.255.255.0" with administrator privileges'

# Confirm
ifconfig en0 | awk '/inet /{print}'
# expect both 192.168.100.x AND 192.168.50.10

ping -c 2 192.168.50.64
```

### Verify camera + ShelfSign path

Credentials (lab default; also stored on the `cameras` row for “Real Hikvision”):

- Host: `192.168.50.64`
- User: `admin`
- Pass: value in `backend/.env` comment / DB (`HIKVISION_PASS` / `cameras.password`)

```bash
# Device info
curl -s --digest -u 'admin:<PASSWORD>' \
  http://192.168.50.64/ISAPI/System/deviceInfo | head

# Snapshot
curl -s --digest -u 'admin:<PASSWORD>' \
  -o /tmp/hik.jpg \
  http://192.168.50.64/ISAPI/Streaming/channels/101/picture
file /tmp/hik.jpg

# Vision service MJPEG proxy (services must be running)
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 \
  "http://127.0.0.1:8000/cmos/stream?host=192.168.50.64&username=admin&password=<PASSWORD>"
```

Expect model like `DS-2CD1323G0E-I`, JPEG snapshot, vision stream HTTP `200`. Then refresh the supplier camera stream in the UI.

### Remove alias (optional)

```bash
osascript -e 'do shell script "ifconfig en0 -alias 192.168.50.10" with administrator privileges'
```

## If alias does not help

1. **Power / PoE / cable** on the camera — confirm link lights.
2. **Wrong network** — Mac briefly on `192.168.120.x` (or similar) sees **0** Hikvisions; reconnect to the `192.168.100.x` lab LAN first, then add the `50.10` alias.
3. **IP moved** — fleet may also appear as `192.168.100.200`–`224`. Those are different devices/IPs; do not assume they accept the `50.64` password without testing.
4. **App still points at `50.64`** — check DB:

```bash
docker exec supabase_db_ShelfSign psql -U postgres -d postgres \
  -c "select host, username, label from cameras order by label;"
```

## Related stubs

- **fake-cam** (`127.0.0.1:8788`) is separate. If that stream fails, the stub process usually is not running:

```bash
cd fake-cam && source .venv/bin/activate && python stdlib_server.py
```

See `fake-cam/README.md`.

## Checklist (copy/paste)

```text
[ ] Mac on lab LAN (typically 192.168.100.x)
[ ] Alias 192.168.50.10 on en0
[ ] ping 192.168.50.64 OK
[ ] ISAPI deviceInfo 200 with stored admin password
[ ] Snapshot JPEG OK
[ ] vision-service + backend + frontend running
[ ] UI Real Hikvision stream refreshes
```
