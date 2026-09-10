# ShelfSign Pitch — speaker beats

Native Next.js deck (no Reveal.js).

- **Open:** http://localhost:3000/pitch
- **Fullscreen:** http://localhost:3000/pitch?fullscreen=1 (tap the gate, or press `F` / use **Full** in the nav)
- **Code:** `frontend/src/app/pitch/`
- **Assets:** `frontend/public/pitch/assets/`

## Controls

- `→` / `Space` / tap next — advance fragment, then slide
- `←` — back
- `F` — toggle fullscreen
- Swipe on touch devices

## One-sentence story

Buyers get stock proof from **this camera chip, right now** — not a signed JPEG from a laptop.

## Fraud-proof glossary (say these names)

| Mechanism | What to say |
|-----------|-------------|
| **Silicon / CMOS** | The image sensor chip behind the lens. |
| **Impurity → PUF** | Tiny manufacturing defects leave unique noise. That Physical Unclonable Function becomes the camera identity. |
| **BCH fuzzy extract** | Helper data + majority vote + IRCUT settle → stable secp256k1 camera account. |
| **OSD nonce** | Server one-time challenge written on-camera; OCR must read it back from the JPEG. |
| **PRNU** | Classical sensor-noise correlate — catches swaps even if a key were stolen. |
| **PUF regen** | `respond_to_challenge` re-derives the key on the live device. |
| **Synthetic gate** | `assert_physical_device` fails closed on fake-cam / phone stubs. |
| **HCS + bond** | Attestation on Hedera; escrow slashed on fraud. |
| **x402** | Buyers pay to unlock the proof. |

## Slide map + talk track

1. **Hero** — “Stock proof from the chip itself — this sensor, right now.”
2. **Buyer problem** — Trust breaks before the order.
3. **Why today fails** — Easy to fake. Hard to prove.
4. **Insight** — Software key vs this camera / right now. Tease: next slide shows *how*.
5. **Solution (teach)** — Diagram: silicon → impurity/PUF → OSD nonce. Pause on each legend.
6. **Pipeline** — Enroll → bond → challenge → witness → detect → verify → publish (function names in cue).
7. **Anti-fake stack** — Eight layers; each blocks a different cheat.
8. **Who** — Fake cam (no PUF) vs real CMOS + roles.
9. **Shipped** — Bond, x402 price, nonce TTL, real UI.
10. **Close** — Chip ID · right now · noise match · stable key · on-chain · pay to see.

## Solution slide — teach in 30 seconds

1. **Silicon** — CMOS chip turns light into pixels.
2. **Impurity / PUF** — Random defects = unclonable fingerprint → camera crypto ID.
3. **OSD nonce** — Fresh code burned into the JPEG → proves live, not replay.
