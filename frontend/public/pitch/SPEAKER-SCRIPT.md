# ShelfSign — Speaker Script

**Audience:** hackathon judges · technical judges · investors · live-demo watchers  
**Target:** ~60 seconds spoken, then demo. Full deck: 3–5 minutes with slides.

---

## 60-second pitch

**HOOK**  
ShelfSign is camera-backed stock — signed from the silicon, attested with a live nonce.

**PROBLEM**  
Buyers can’t trust supplier inventory before they order. What they get is a spreadsheet, a screenshot, a phone photo. None of that answers: is this current, from this warehouse, from this camera, right now?

**INSIGHT**  
Software trust is not warehouse trust. A private key proves someone had the key. It does not prove that this physical camera answered this challenge.

**SOLUTION**  
We enroll the camera’s CMOS identity, lock a mandatory 10 HBAR bond, burn a short-lived nonce into the live Hikvision frame, match silicon, run YOLO as evidence, verify signature and image hash, and publish to Hedera HCS. Buyers unlock that evidence with x402 — pay per query.

**DEMO ASK**  
I’m going to enroll a camera, attest a shelf, unlock as a buyer — then try to break it with a replay and a fake camera.

**Let me show you.**

---

## Slide-by-slide notes

| # | Slide | Say |
|---|--------|-----|
| 01 | Hero | Name + one-liner. Real aisle frame behind the trust chain. |
| 02 | Problem | “Trust breaks before the order.” Warehouse photo + spreadsheet/screenshot/phone. |
| 03 | Why today fails | Easy to fake vs what buyers need. Old image ✕ / live challenge ✓. |
| 04 | Insight | **Software trust ≠ warehouse trust.** |
| 05 | Solution | Live stock from **this camera, right now.** |
| 06 | Pipeline | Tap 01–07. YOLO = camera evidence, not perfect inventory. |
| 07 | Anti-fake stack | Build layers. PRNU informational unless asked. |
| 08 | Who uses it | Supplier attests / buyer x402. Not remittance escrow. |
| 09 | Demo | Real UI shots: live view → buyer stock → x402 unlock → REPLAY/FAKE ✕ → cut live. |
| 10 | Shipped | 10 ℏ · ~0.01 ℏ · 2 min TTL + real login/attestation/supplier screens. |
| 11 | Close | **Let’s attest a shelf.** No thank-you slide. |

---

## Capture notes (for presenters)

Screenshots in `pitch/assets/` were taken from the running local stack:

- Demo login: `demo.supplier1@example.com` / `demo.buyer1@example.com` · `ShelfSignDemo1!`
- Hero / aisle frames: live ISAPI JPEG from lab Hikvision `192.168.50.64` (`DS-2CD1323G0E-I`) → `pitch/assets/hik-live.jpg` (also `cam-frame.jpg`, `wh-cinematic.jpg`)
- Buyer stock shows real UI: Verified · CMOS score · Pay & unlock (0.01 HBAR) · attestation modal

---

## Honest lines (use if asked)

- **YOLO:** Camera evidence, not perfect inventory truth.
- **PRNU:** Informational unless `SHELFSIGN_ENFORCE_PRNU=1`.
- **Bond slash:** Unverified/`is_fake` live; auto-slash not claimed as fully wired.
- **Scope:** Not a remittance/escrow marketplace.

---

## Demo handoff

After slide 09 or 11: **“Let me show you.”** → live UI.
