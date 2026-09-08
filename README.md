# ShelfSign

**Camera-backed stock, signed from the silicon — attested with a live nonce.**

Warehouses publish live inventory from enrolled cameras. Each attestation is bound to the camera’s CMOS sensor fingerprint and a fresh server-issued nonce, so buyers see stock that is hard to fake or replay.

---

## Problem

Buyers cannot reliably see real supplier inventory. Spreadsheets and chat updates go stale or get fabricated. Trust breaks before an order is placed.

## Solution

1. Put a camera in the warehouse aisle.
2. Derive a **camera account identity** from the CMOS sensor’s manufacturing impurity fingerprint (PRNU / silicon noise pattern) — unique per physical sensor.
3. Challenge the warehouse with an **attestable nonce**.
4. Capture a live frame bound to that nonce; verify it matches the enrolled CMOS fingerprint.
5. Run vision (YOLO / PyTorch) → stock counts.
6. Publish a **signed stock attestation** (image hash + CMOS account + nonce + counts).
7. Buyers browse attested stock and place buy orders. Pay-per-query access is live via **Hedera x402**; optional **USDC bond + slash** (Arc) is planned.

**Tagline:** Live stock from _this_ camera, _right now_ — silicon identity + nonce, not a spreadsheet.

---

## Core trust model: CMOS account + nonce

### CMOS silicon impurity → account signature

Every CMOS image sensor has a stable, device-unique noise pattern from manufacturing impurities. That fingerprint becomes the **camera’s account identity**:

- **Enroll once:** capture calibration frames → extract impurity / PRNU template → bind to camera account.
- **Later frames:** extract residual fingerprint → must match enrolled template.
- Wrong camera, phone photo, or swapped device → **fail**.

The hardware root: _the signature is tied to the physical sensor, not just a software key on a laptop._

### Attestable nonce → prove the warehouse is live

Replay of yesterday’s full shelves must fail.

```
ShelfSign server          Warehouse agent + camera
      |                              |
      |---- challenge(nonce) ------->|
      |                              | capture frame
      |                              | bind nonce (overlay / HMAC)
      |                              | check CMOS fingerprint
      |                              | vision → stock
      |<--- attestation + sig -------|
      | verify: nonce fresh          |
      |         CMOS match           |
      |         image hash           |
      |         signature            |
      | publish                       |
```

If the warehouse can’t return a fingerprint-matching frame for the **current nonce** → treat as offline / no live data.

---

## How it works (full pipeline)

```
Enroll camera CMOS impurity fingerprint → camera account identity
       ↓
Server issues attestable nonce
       ↓
Live snapshot (Hikvision / RTSP / local agent)
       ↓
Verify CMOS fingerprint == enrolled account
       ↓
Vision model (YOLO / PyTorch) → SKU labels, counts, confidence
       ↓
Attestation: stock + imageHash + cameraAccount + nonce + modelHash
       ↓
Sign (camera-bound account / supplier key)
       ↓
Attestation → Hedera HCS (live) / Arc bond (planned)
       ↓
Buyer browses attested stock → x402 unlock → places buy order
```

### Anti-fake layers

| Layer                               | Stops                                                |
| ----------------------------------- | ---------------------------------------------------- |
| CMOS impurity fingerprint → account | Phone uploads, swapped cameras, generic stock photos |
| Attestable nonce                    | Replay of old “full shelf” videos                    |
| Image hash + HCS log                | Editing the photo after the fact; silent rewrite     |
| Signature                           | Random third-party forgery                           |
| Model hash                          | Silent detector swap                                 |
| Fraud flag (`is_fake` in DB)        | Persist unverified camera after CMOS/sig fail        |
| USDC bond + slash (planned)         | Cheap lying about staged aisles                      |

A supplier can still stage the real aisle before the shot — bond + dispute covers that once shipping. Camera physics stops _remote_ faking and replay.

---

## Progress tracker

Checkboxes mark what is done in the repo today. Unchecked items are still open.

### Platform & auth

- [x] Supabase schema + RLS (`supabase/migrations/`)
- [x] Signup / login (supplier & buyer roles)
- [x] Role-based routing (`/supplier` · `/buyer`)
- [x] Demo account seeding (`npm run seed:demo`)
- [x] Demo stock seeding for buyer catalog (`npm run seed:demo-stock`)
- [x] Paginated buyer stock catalog API (`GET /warehouses/catalog`)
- [x] Responsive UI (desktop / tablet / mobile)

### Supplier

- [x] Dashboard overview (order + warehouse KPIs)
- [x] Warehouses — create, categories, photo
- [x] Cameras — register (label only; creds from DB), enrollment status, live stream
- [x] Incoming orders — list, filter, search
- [x] Order detail — confirm / fulfill / cancel + status progress
- [ ] Local warehouse agent (credentials stay on LAN)
- [x] CMOS/PUF enroll + SiliconWitness challenge-response (Hikvision ISAPI)
- [x] Supplier attest wizard (nonce → SiliconWitness challenge → YOLO counts)
- [x] `POST /cameras/:id/attest` server-side verification (not client-trusted flags)
- [x] `system_settings` DB table for camera/vision config (no frontend secrets)

### Buyer

- [x] Home — purchasing KPIs + recent orders / stock
- [x] Stock catalog — search, filters, sort, product grid
- [x] Stock detail — attestation provenance + place order
- [x] Orders — list, status filters, search
- [x] Order detail — status timeline (Placed → Confirmed → Fulfilled)
- [x] Profile (read-only)
- [ ] Cart / multi-line checkout
- [ ] Pricing, taxes, shipping
- [ ] Buyer delivery addresses
- [ ] Carrier tracking / ETA
- [ ] Reorder / notifications / profile edit

### Trust pipeline

- [x] Nonce challenge API
- [x] Attestation ingest + public read
- [x] Warehouse browse + stock by attestation
- [x] Buy orders linked to attestation (optional)
- [x] Vision service — YOLO stock detection (FastAPI + Ultralytics/PyTorch)
- [x] CMOS fingerprint endpoints (PUF enroll/match/challenge; SiliconWitness path)
- [x] Hedera HCS attestation publishing (`npm run setup:hcs`)
- [x] x402 paywalled stock queries (Blocky402 + Hedera exact scheme)
- [x] Camera fraud / unverified flag + concurrent attest lock (`0008` / `0009`)
- [x] `fake-cam/` ISAPI stub for controlled CMOS-reject demos
- [ ] Classical PRNU residual correlation (current path is pixel-stability PUF)
- [ ] Arc USDC bond / slash
- [ ] The Graph indexing for bond/slash events
- [x] Chainlink CRE confidential fraud review (`cre/fraud-review`, TEE `handlerInTee`)

### Buyer routes

| Route                              | Done |
| ---------------------------------- | ---- |
| `/buyer`                           | [x]  |
| `/buyer/stock`                     | [x]  |
| `/buyer/stock/[warehouseId]/[sku]` | [x]  |
| `/buyer/orders`                    | [x]  |
| `/buyer/orders/[id]`               | [x]  |
| `/buyer/profile`                   | [x]  |

### Supplier routes

| Route                       | Done |
| --------------------------- | ---- |
| `/supplier`                 | [x]  |
| `/supplier/orders`          | [x]  |
| `/supplier/orders/[id]`     | [x]  |
| `/supplier/warehouses`      | [x]  |
| `/supplier/warehouses/[id]` | [x]  |

---

## Example attestation

```json
{
  "supplier": "0x…",
  "warehouse": "ktm-01",
  "cameraAccount": "cam_cmos_0xabc…",
  "cmosFingerprintHash": "0x…",
  "nonce": "0xdeadbeef…",
  "nonceIssuedAt": 1788600000,
  "capturedAt": 1788600005,
  "imageHash": "0x…",
  "model": "yolov8n-stock-v1",
  "modelHash": "0x…",
  "items": [
    { "sku": "RICE-25KG", "count": 42, "confidence": 0.91, "shelf": "A3" }
  ]
}
```

Verification checklist before accepting stock as live:

1. `nonce` is one we issued and not expired / not reused
2. `cmosFingerprintHash` matches enrolled camera account
3. Frame is bound to `nonce` (watermark or `HMAC(frame, nonce)`)
4. `imageHash` matches the captured frame
5. Signature validates under camera / supplier account
6. Attestation is published to Hedera HCS (topic + sequence)

---

## Camera access

Prefer a **local warehouse agent**:

- Runs on their LAN next to the camera
- Holds camera credentials locally
- Receives nonce challenges from ShelfSign
- Returns only attestations (+ image hash; frame stays on LAN unless streamed)

Buyers never get RTSP. The cloud never needs the warehouse’s camera admin password.

---

## Stack

- **Frontend:** Next.js (App Router), TypeScript, Supabase Auth
- **Backend:** Node / Express (TypeScript) — nonce, attestations, cameras, warehouses, orders, HCS publish, x402
- **Vision:** Python FastAPI — YOLO stock detection + CMOS / PUF (SiliconWitness-style) fingerprinting
- **Data:** Supabase (Postgres + RLS)
- **Chain (live):** Hedera testnet — HCS attestation log + x402 pay-per-query (HTS USDC via Blocky402)
- **Chainlink CRE:** Confidential fraud review workflow (`cre/`) — TEE scores private camera risk; public CLEAR/HOLD/SLASH only
- **Planned:** Arc USDC bond / slash (optional; not required for ETHOnline Chainlink track)

---

## Repo structure

```
ShelfSign/
├── frontend/            Next.js — auth, supplier & buyer dashboards
├── cre/                 Chainlink CRE confidential fraud-review workflow (TEE)
├── backend/             Express — nonce, attest verify, HCS, x402, cameras / warehouses / orders
├── vision-service/      FastAPI — YOLO + CMOS/PUF enroll & challenge
├── fake-cam/            Demo-only Hikvision ISAPI stub (CMOS-reject demos)
├── supabase/migrations/ SQL schema + RLS
└── .claude/agents/      Scoped subagents per stack area
```

---

## Getting started

```bash
# 1. Local Supabase (or a hosted project) + apply migrations
supabase start
supabase db push --local   # or run supabase/migrations/*.sql in the SQL editor

# frontend
cd frontend && cp .env.example .env.local  # fill NEXT_PUBLIC_SUPABASE_* + NEXT_PUBLIC_API_URL
npm install && npm run dev

# backend
cd backend && cp .env.example .env  # fill SUPABASE_* ; then fund Hedera + npm run setup:hcs
npm install && npm run dev

# vision-service
cd vision-service && cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

Hedera (required for HCS publish + x402 settle):

```bash
cd backend
# Fund OPERATOR + AGENT EVM addresses at https://faucet.hedera.com
# Or set HEDERA_PAT and run:
npm run setup:hcs
```

`frontend/` and `backend/` are npm workspaces off the root `package.json` — `npm install` from the repo root installs both.

---

## Demo accounts

Ten seeded accounts (5 supplier, 5 buyer). All share one password.

**Password:** `ShelfSignDemo1!`

| Role     | Email                        | Company                |
| -------- | ---------------------------- | ---------------------- |
| Supplier | `demo.supplier1@example.com` | Himalayan Traders      |
| Supplier | `demo.supplier2@example.com` | Kathmandu Cold Storage |
| Supplier | `demo.supplier3@example.com` | Everest Steel Works    |
| Supplier | `demo.supplier4@example.com` | Pokhara Farm Supply    |
| Supplier | `demo.supplier5@example.com` | Terai Auto Parts       |
| Buyer    | `demo.buyer1@example.com`    | Bhattarai Retail       |
| Buyer    | `demo.buyer2@example.com`    | Kathmandu Mart         |
| Buyer    | `demo.buyer3@example.com`    | Valley Wholesale       |
| Buyer    | `demo.buyer4@example.com`    | Sunrise Distributors   |
| Buyer    | `demo.buyer5@example.com`    | Himal Convenience      |

Log in at `/login` — suppliers go to `/supplier`, buyers to `/buyer`.

To (re)create accounts against a fresh Supabase project:

```bash
cd backend
npm run seed:demo
npm run seed:demo-stock   # warehouses + attested SKUs for buyer catalog search/filter
npm run seed:camera-settings  # Hikvision host/user/pass + vision URL → system_settings
```

Before `seed:camera-settings`, apply `supabase/migrations/0004_system_settings.sql` in the Supabase SQL editor. Until then, enroll/attest fall back to `HIKVISION_*` / `VISION_SERVICE_URL` in `backend/.env` (synced from SiliconWitness for now).

Uses the Supabase admin API (`SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`). Re-running is safe — existing accounts are reused and profiles re-synced. Stock seeding replaces attestations on demo cameras.

Buyer stock catalog loads from `GET /warehouses/catalog` (search, filters, sort, pagination).

---

## Demo script

1. Enroll camera → show CMOS account id
2. Issue nonce challenge (OSD + IR / night aligned with enroll)
3. Live aisle frame bound to nonce
4. CMOS match ✓ + YOLO counts
5. Publish attestation → **Hedera HCS** (HashScan topic link)
6. Buyer unlocks stock via **x402** and places an order
7. Supplier confirms / fulfills the order
8. Replay old frame with stale nonce → **reject**
9. Point enrolled cam at `fake-cam` stub (or phone photo) → **CMOS fail** + unverified flag

Two-warehouse seed (real Hikvision + fake-cam):

```bash
cd fake-cam && python stdlib_server.py   # :8788, admin / FakeCamDemo1!
cd backend && npm run seed:two-warehouses
```

---

## What this is not

- Not freelance escrow or remittance
- Not a claim that vision counts are perfect inventory truth
- Not requiring buyers (or the cloud) to hold the camera password
