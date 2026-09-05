# ShelfSign

**Camera-backed stock, signed from the silicon — attested with a live nonce.**

ETHOnline 2026 project idea. Real itch from Fix My Itch (Razorpay): *“Why can't shops see real-time supplier stock levels?”*

---

## Problem

Shops and buyers can’t see real supplier inventory. Spreadsheets and WhatsApp updates are easy to fake or go stale. Trust breaks before the order is placed.

## Solution

1. Put a camera in the warehouse aisle.  
2. Derive a **camera account identity** from the CMOS sensor’s manufacturing impurity fingerprint (PRNU / silicon noise pattern) — unique per physical sensor.  
3. Challenge the warehouse with an **attestable nonce**.  
4. Capture a live frame bound to that nonce; verify it matches the enrolled CMOS fingerprint.  
5. Run vision (YOLO / PyTorch) → stock counts.  
6. Publish a **signed stock attestation** (image hash + CMOS account + nonce + counts).  
7. Buyers / agents pay per query (**x402**). Optional USDC bond: lying stays expensive.

**Tagline:** Live stock from *this* camera, *right now* — silicon identity + nonce, not a spreadsheet.

---

## Core trust model: CMOS account + nonce

### CMOS silicon impurity → account signature

Every CMOS image sensor has a stable, device-unique noise pattern from manufacturing impurities. That fingerprint becomes the **camera’s account identity**:

- **Enroll once:** capture calibration frames → extract impurity / PRNU template → bind to on-chain camera account (or derive key material / attestation identity from it).  
- **Later frames:** extract residual fingerprint → must match enrolled template.  
- Wrong camera, phone photo, or swapped device → **fail**.

This is the hardware root: *the signature is tied to the physical sensor, not just a software key sitting on a laptop.*

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
      | publish on-chain             |
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
Image → IPFS    |    Attestation → Hedera HCS / Arc
       ↓
Buyer / agent pays x402 → GET attested stock
```

### Anti-fake layers

| Layer | Stops |
|--------|--------|
| CMOS impurity fingerprint → account | Phone uploads, swapped cameras, generic stock photos |
| Attestable nonce | Replay of old “full shelf” videos |
| Image hash on-chain | Editing the photo after the fact |
| Signature | Random third-party forgery |
| Model hash | Silent detector swap |
| USDC bond + slash | Cheap lying about staged aisles |

Pitch: **silicon-bound, nonce-fresh, slashable attestations.**  
A supplier can still stage the real aisle before the shot — bond + dispute covers that. Camera physics stops *remote* faking and replay.

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
  "imageCid": "ipfs://…",
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
4. `imageHash` matches published image  
5. Signature validates under camera / supplier account  

---

## Camera access (no admin password to us)

Prefer a **local warehouse agent**:

- Runs on their LAN next to the camera  
- Holds camera credentials locally  
- Receives nonce challenges from ShelfSign  
- Returns only attestations (+ optional image CID)  

Buyers never get RTSP. We never need the warehouse’s camera admin password in the cloud.

---

## Suggested stack

- **Camera:** Hikvision / any CMOS IP cam + local agent (phone upload only as weak fallback)  
- **Identity:** CMOS impurity / PRNU template → `cameraAccount`  
- **Liveness:** server-issued attestable nonce  
- **Vision:** Ultralytics YOLO (PyTorch); start with 3–5 SKUs/bins  
- **Chain:** Hedera HCS for attestations + stake, and/or Arc USDC bond  
- **Access:** x402 paywalled `GET /stock/:supplier/:sku`  
- **Index:** The Graph or simple event indexer  

---

## Repo structure

```
ShelfSign/
├── frontend/          Next.js (TypeScript) — buyer dashboard, attested stock view, x402 pay UI
├── backend/           Node/Express (TypeScript) — nonce issuance, attestation verify, Hedera/Arc, x402 gateway
├── vision-service/     Python (FastAPI) — YOLO stock detection + CMOS/PRNU sensor fingerprinting
└── .claude/agents/     Claude Code subagents scoped to each part of the stack (see below)
```

Scaffolding only — folder structure, package configs, and stubbed entry points.
No feature code yet (matches project status below).

### Getting started (dev)

```bash
# frontend (Next.js)
cd frontend && cp .env.example .env.local && npm install && npm run dev

# backend (Node/Express)
cd backend && cp .env.example .env && npm install && npm run dev

# vision-service (Python)
cd vision-service && cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

### Claude Code subagents

Each part of the stack has a scoped subagent in `.claude/agents/` so work stays
in its lane and picks up the right conventions automatically:

| Agent | Scope |
|-------|-------|
| `frontend-dev` | `frontend/` — Next.js dashboard, attestation/nonce UI, x402 payment flow |
| `backend-dev` | `backend/` — nonce/attestation/stock routes, verification pipeline |
| `vision-cmos` | `vision-service/` — YOLO detection + CMOS/PRNU fingerprinting |
| `blockchain-attestation` | Cross-cutting — attestation schema, Hedera HCS, Arc bond/slash, x402 scheme, IPFS |

---

## Skills required

What a contributor needs to actually build this, mapped to the piece it touches:

| Area | Skills |
|------|--------|
| **Frontend** | TypeScript, React, Next.js (App Router), basic Web3 payment UX |
| **Backend** | Node.js, Express, REST API design, JWT/signature verification, async job handling |
| **Computer vision** | Python, PyTorch, Ultralytics YOLO, OpenCV, object detection fundamentals |
| **Sensor fingerprinting** | Digital image forensics / PRNU analysis, signal processing (wavelet denoising, cross-correlation) — the niche, hardest-to-hire-for skill here |
| **Cryptography** | Digital signatures (ECDSA or equivalent), hashing, HMAC, key management for camera-bound identities |
| **Blockchain / Web3** | Hedera SDK (HCS topics, accounts), Arc/EVM basics, USDC/ERC-20 mechanics, x402 payment protocol |
| **Infra** | IPFS pinning, indexing (The Graph or a custom event indexer), env/secrets management for a local warehouse agent |
| **Domain** | Retail/warehouse inventory workflows — useful for realistic SKU/shelf modeling and demo credibility |

---

## Claude Code plugins & skills

Installed to accelerate the pieces above (via `claude plugin install`, from
Anthropic's official marketplace unless noted):

| Plugin | Scope | Covers |
|--------|-------|--------|
| [`frontend-design`](https://github.com/anthropics/claude-plugins-public/tree/main/plugins/frontend-design) | Project + global | Anthropic's official design skill — pushes toward a deliberate visual direction and production-grade UI instead of generic AI-default styling. Most-installed design plugin in the official directory. |
| [`modern-web-guidance`](https://github.com/GoogleChrome/modern-web-guidance) | Global | Google Chrome's plugin — keeps frontend work aligned with current web platform best practices; bundles a Chrome-extensions skill too. |
| [`convex`](https://github.com/get-convex/convex-backend-skill) | Global | Reactive TypeScript backend platform skill — schema design, auth, realtime, file storage, scheduled jobs, plus a `convex-reviewer` subagent. **Adopting it means replacing `backend/`'s custom Express layer** with Convex functions; that migration hasn't happened yet, this is just the skill being available. Express (`backend/`) stays the backend until that migration is explicitly done. |

Considered but not installed:
- **Figma** / **Superdesign** — extra design-canvas tools; skipped since `frontend-design` already covers UI quality for this build.
- Generic "Node/Express API" skills found via web search (mcpmarket.com, claudedirectory.org, etc.) — these are unverified third-party listings outside Anthropic's marketplace, not installed without vetting their source.

Repo-specific Claude Code subagents live in `.claude/agents/` — see
[Repo structure](#repo-structure) above.

---

## ETHOnline prize fit

- **Hedera** — AI & Agentic Payments / x402 metered stock API; HCS for attestation log  
- **The Graph** — index camera accounts, nonces, attestations, disputes  
- **Arc** — USDC bond / settlement  
- **ENS** (optional) — `supplier.eth` / warehouse / camera subnames (ENSv2)  

---

## 60-second demo script

1. Enroll camera → show CMOS account id  
2. Issue nonce challenge  
3. Live aisle frame (nonce visible or bound)  
4. CMOS match ✓ + YOLO counts  
5. Attestation on explorer / HashScan  
6. Buyer pays ~$0.01 via x402 → stock  
7. Replay old frame with stale nonce → **reject**  
8. Different camera / phone photo → **CMOS fail**  

---

## Build order (hackathon)

1. Local agent + snapshot  
2. CMOS fingerprint enroll + match (even a simplified residual template is fine for demo)  
3. Nonce challenge–response  
4. YOLO on one shelf  
5. Hash + sign + publish attestation  
6. x402 query API  
7. Stake / slash (last)  

---

## Naming

**ShelfSign** — shelves → signed claims from silicon-bound cameras.

Alternatives considered: StockAttest, CamClaim, ProofShelf, AisleOracle, VeriStock, HashShelf, SightStake.

---

## What this is *not*

- Not another freelance escrow  
- Not a remittance app  
- Not “generic x402 pay for an API” without a real-world oracle  
- Not claiming vision counts are perfect inventory truth  
- Not requiring buyers (or our cloud) to hold the camera password  

---

## Sources

- Fix My Itch (Razorpay): supplier stock visibility itch  
- Competitive note: inventory SaaS exists; **CMOS-bound + nonce-fresh stock attestations sold pay-per-query** is still thin at ETHGlobal  

---

## Status

Idea documented (CMOS account signature + attestable nonce). Repo scaffolded
(frontend/backend/vision-service structure + configs + Claude Code subagents).
Feature implementation not started.

**Internal rating:** ~8.5/10 for ETHOnline if demo shows nonce reject + CMOS mismatch clearly.
