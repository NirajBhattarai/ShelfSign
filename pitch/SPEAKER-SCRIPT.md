# ShelfSign Pitch — speaker beats

Native Next.js deck (no Reveal.js).

- **Open:** http://localhost:3000/pitch
- **Fullscreen:** http://localhost:3000/pitch?fullscreen=1 (tap the gate, or press `F` / use **Full** in the nav)
- **Code:** `frontend/src/app/pitch/`
- **Assets:** `frontend/public/pitch/assets/`

## Controls

- `→` / `Space` / tap next — advance slide
- `←` — back
- `F` — toggle fullscreen
- Swipe on touch devices

## One-sentence story

Buyers get stock proof from **this camera chip, right now** — not a signed JPEG from a laptop.

## Fraud-proof glossary (say these names)

| Mechanism             | What to say                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Silicon / CMOS**    | The image sensor chip behind the lens.                                                                        |
| **Impurity → PUF**    | Tiny manufacturing defects leave unique noise. That Physical Unclonable Function becomes the camera identity. |
| **BCH fuzzy extract** | Helper data + majority vote + IRCUT settle → stable secp256k1 camera account.                                 |
| **OSD nonce**         | Server one-time challenge written on-camera; OCR must read it back from the JPEG.                             |
| **PRNU**              | Classical sensor-noise correlate — catches swaps even if a key were stolen.                                   |
| **PUF regen**         | `respond_to_challenge` re-derives the key on the live device.                                                 |
| **Synthetic gate**    | `assert_physical_device` fails closed on fake-cam / phone stubs.                                              |
| **HCS + bond**        | Attestation on Hedera; escrow slashed on fraud.                                                               |
| **x402**              | Buyers pay to unlock the proof.                                                                               |

## Slide map + talk track

1. **Hero** — “Stock proof from the chip itself — this sensor, right now.”
2. **Problem → solve** — Triptych all at once: warehouse photo · fake cam/phone · live bonded frame. Bottom rails: buyers can’t know vs ShelfSign proves. Hold and talk — no step-through.
3. **Solution (teach)** — Diagram: silicon → impurity/PUF → OSD nonce (all legends visible).
4. **Anti-fake stack** — Eight layers in one frame; each blocks a different cheat.
5. **Who** — Fake cam (no PUF) vs real CMOS + roles.
6. **Shipped** — Bond, x402 price, nonce TTL, real UI.
7. **Close** — Chip ID · right now · noise match · stable key · on-chain · pay to see.

**Skipped on purpose:** enroll → chain pipeline slide — show that live in the 2/10 demo.

## Problem → solve — talk in 40 seconds

- **Left photos:** “This is what buyers get — a warehouse shot and a camera frame. Looks real. Zero proof it’s current, this site, or this device.”
- **Doubts:** Current? This warehouse? This camera? Right now?
- **Right:** “ShelfSign answers with a bonded camera: silicon ID, live OSD nonce, signed frame, buyer unlock.”

## Solution slide — teach in 30 seconds

1. **Silicon** — CMOS chip turns light into pixels.
2. **Impurity / PUF** — Random defects = unclonable fingerprint → camera crypto ID.
3. **OSD nonce** — Fresh code burned into the JPEG → proves live, not replay.
