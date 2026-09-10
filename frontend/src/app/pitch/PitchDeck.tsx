"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./pitch.css";

const A = "/pitch/assets";

function Viewfinder() {
  return (
    <div className="viewfinder" aria-hidden>
      <span className="c tl" />
      <span className="c tr" />
      <span className="c bl" />
      <span className="c br" />
    </div>
  );
}

function Hud({ children }: { children: ReactNode }) {
  return (
    <div className="hud-tag">
      <span className="live-dot" />
      {children}
    </div>
  );
}

function Frag({
  show,
  className = "",
  children,
}: {
  show: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`frag fade-up ${className} ${show ? "is-shown" : ""}`}>
      {children}
    </div>
  );
}

type SlideProps = { step: number };

function SlideHero(_p: SlideProps) {
  return (
    <>
      <Viewfinder />
      <Hud>REC · WAREHOUSE ATTESTATION</Hud>
      <div className="shell">
        <div className="hero">
          <div>
            <div className="kicker enter-up">LIVE FROM THE SILICON</div>
            <h1 className="brand enter-up d1">
              Shelf<em>Sign</em>
            </h1>
            <p className="lede paper enter-up d2">
              Stock proof from the camera chip itself — this sensor, right now,
              not a photo and not a replay.
            </p>
            <div className="ticker enter-up d3">
              silicon ID · live nonce · signed frame · Hedera
            </div>
          </div>
          <div className="cam-stage enter-scale d2">
            <div className="bg" />
            <div className="veil" />
            <div className="scanbeam" />
            <div className="cam-chain">
              <div className="step">
                <span className="pip" />
                CAMERA
              </div>
              <div className="arrow">↓</div>
              <div className="step">
                <span className="pip" />
                CMOS ID
              </div>
              <div className="arrow">↓</div>
              <div className="step">
                <span className="pip" />
                LIVE NONCE
              </div>
              <div className="arrow">↓</div>
              <div className="step">
                <span className="pip" />
                VERIFIED STOCK
              </div>
            </div>
            <div className="cam-meta">
              <span>HIKVISION · DS-2CD1323G0E-I · 192.168.50.64</span>
              <span className="ok">LIVE ISAPI</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SlideProblem({ step }: SlideProps) {
  const doubts = [
    { q: "CURRENT?", hint: "Or last week’s count?", icon: "clock" },
    {
      q: "THIS WAREHOUSE?",
      hint: "Or another site’s photo?",
      icon: "warehouse",
    },
    { q: "THIS CAMERA?", hint: "Or a phone upload?", icon: "camera" },
    { q: "RIGHT NOW?", hint: "Or a replayed frame?", icon: "scan-line" },
  ] as const;

  const fakes = [
    { t: "SPREADSHEET", icon: "file-spreadsheet" },
    { t: "SCREENSHOT", icon: "image" },
    { t: "PHONE PHOTO", icon: "smartphone" },
  ] as const;

  return (
    <>
      <Viewfinder />
      <div className="shell top">
        <div className="kicker enter-up">THE BUYER PROBLEM</div>
        <h2 className="headline wide enter-up d1">
          Trust breaks before the order.
        </h2>
        <div className="problem-grid problem-grid-v2">
          <div className="media-card enter-left d2">
            <img src={`${A}/wh-cinematic.jpg`} alt="Warehouse aisle" />
            <div className="stamp">
              <div className="warn">NO CAMERA PROOF · NO LIVE CHALLENGE</div>
              <div className="title">A photo is not evidence.</div>
            </div>
            <div className="media-scan" aria-hidden />
          </div>
          <div className="doubt-stack enter-right d3">
            {doubts.map((d, i) => (
              <Frag key={d.q} show={step > i} className="doubt doubt-soft">
                <span className="ico-well muted">
                  <img src={`${A}/icons/${d.icon}.svg`} alt="" />
                </span>
                <div className="doubt-copy">
                  <span className="doubt-q">{d.q}</span>
                  <span className="doubt-hint">{d.hint}</span>
                </div>
              </Frag>
            ))}
          </div>
        </div>
        <div className="fake-strip fake-strip-v2">
          {fakes.map((item, i) => (
            <Frag
              key={item.t}
              show={step > 4 + i}
              className="fake-chip fake-soft"
            >
              <span className="ico-well muted">
                <img src={`${A}/icons/${item.icon}.svg`} alt="" />
              </span>
              <span className="fake-name">{item.t}</span>
              <span className="fake-badge soft">UNVERIFIED</span>
            </Frag>
          ))}
        </div>
      </div>
    </>
  );
}

function SlideWhy({ step }: SlideProps) {
  const fakeItems = [
    {
      icon: "file-spreadsheet",
      title: "SPREADSHEET",
      sub: "Copied · edited · stale",
    },
    {
      icon: "image",
      title: "SCREENSHOT",
      sub: "Cropped · reused · unproven",
    },
    {
      icon: "smartphone",
      title: "OLD PHOTO",
      sub: "Yesterday’s full shelf",
    },
    {
      icon: "key",
      title: "SOFTWARE KEY",
      sub: "Laptop signed a claim",
    },
  ] as const;
  const needItems = [
    { icon: "camera", title: "THIS CAMERA", sub: "Physical CMOS identity" },
    { icon: "clock", title: "RIGHT NOW", sub: "Live challenge window" },
    { icon: "scan-line", title: "LIVE NONCE", sub: "OSD burned into frame" },
    { icon: "shield-check", title: "PHYSICAL ID", sub: "Silicon, not a file" },
    { icon: "warehouse", title: "AUDIT TRAIL", sub: "Hedera HCS record" },
  ] as const;

  return (
    <>
      <Viewfinder />
      <div className="shell top why-shell">
        <div className="kicker enter-up">WHY TODAY FAILS</div>
        <h2 className="headline enter-up d1">
          Easy to fake.
          <span className="headline-break"> Hard to prove.</span>
        </h2>

        <div className="duel duel-soft">
          <div className="duel-col fake enter-left d2">
            <div className="duel-head">
              <span className="duel-eyebrow muted">WHAT BUYERS GET</span>
              <span className="duel-stamp soft-reject">UNTRUSTED</span>
            </div>
            <div className="duel-stack">
              {fakeItems.map((item, i) => (
                <Frag
                  key={item.title}
                  show={step > i}
                  className="duel-card soft-card"
                >
                  <span className="ico-well muted">
                    <img src={`${A}/icons/${item.icon}.svg`} alt="" />
                  </span>
                  <div className="duel-card-body">
                    <div className="duel-card-title">{item.title}</div>
                    <div className="duel-card-sub">{item.sub}</div>
                  </div>
                  <span className="ico-well dim-x">
                    <img src={`${A}/icons/x.svg`} alt="" />
                  </span>
                </Frag>
              ))}
            </div>
          </div>

          <div className="duel-mid enter-up d3" aria-hidden>
            <div className={`duel-orb ${step > 3 ? "hot" : ""}`}>
              <span>VS</span>
            </div>
            <div className="duel-beam" />
          </div>

          <div className="duel-col need enter-right d3">
            <div className="duel-head">
              <span className="duel-eyebrow good">WHAT BUYERS NEED</span>
              <span className="duel-stamp soft-accept">REQUIRED</span>
            </div>
            <div className="duel-visual">
              <img src={`${A}/cam-frame.jpg`} alt="" />
              <div className="duel-visual-scan" />
              <div className="duel-visual-meta">
                <span className="ok">● LIVE</span>
                <span>THIS CAMERA · RIGHT NOW</span>
              </div>
            </div>
            <div className="duel-need-list">
              {needItems.map((item, i) => (
                <Frag
                  key={item.title}
                  show={step > 4 + i}
                  className="need-row soft-need"
                >
                  <span className="ico-well copper">
                    <img src={`${A}/icons/${item.icon}.svg`} alt="" />
                  </span>
                  <span className="need-copy">
                    <strong>{item.title}</strong>
                    <em>{item.sub}</em>
                  </span>
                  <span className="ico-well ok">
                    <img src={`${A}/icons/check.svg`} alt="" />
                  </span>
                </Frag>
              ))}
            </div>
          </div>
        </div>

        <div className="duel-verdict">
          <Frag show={step > 9} className="verdict-pill soft-fail">
            <span className="ico-well muted">
              <img src={`${A}/icons/circle-x.svg`} alt="" />
            </span>
            <span>
              OLD IMAGE
              <small>detached from the warehouse</small>
            </span>
          </Frag>
          <Frag show={step > 10} className="verdict-pill soft-pass">
            <span className="ico-well ok">
              <img src={`${A}/icons/shield-check.svg`} alt="" />
            </span>
            <span>
              LIVE CHALLENGE
              <small>identified camera · fresh nonce</small>
            </span>
          </Frag>
        </div>
      </div>
    </>
  );
}

function SlideInsight(_p: SlideProps) {
  return (
    <>
      <Viewfinder />
      <div className="shell">
        <div className="kicker enter-up">THE INSIGHT</div>
        <h2 className="headline xl enter-up d1">
          Software trust ≠ warehouse trust.
        </h2>
        <p className="lede enter-up d1 insight-lede">
          A laptop can sign any JPEG. A bonded camera must prove{" "}
          <em>which chip</em> answered <em>which challenge</em> — next slide
          shows how.
        </p>
        <div className="insight-compare">
          <div className="insight-box enter-left d2">
            <div className="lab">SOFTWARE KEY</div>
            <p className="body">“Someone with the key signed this.”</p>
            <ul className="insight-fns">
              <li>Private key lives on a laptop</li>
              <li>Any photo can get a signature</li>
              <li>Old footage replays easily</li>
            </ul>
          </div>
          <div className="insight-vs enter-up d3">VS</div>
          <div className="insight-box hot enter-right d3">
            <div className="lab">THIS CAMERA · RIGHT NOW</div>
            <p className="body">
              “This silicon answered this one-time challenge.”
            </p>
            <ul className="insight-fns hot">
              <li>Chip fingerprint → camera identity</li>
              <li>Fresh nonce burned into the frame</li>
              <li>Sensor noise catches swaps &amp; stubs</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function SlideSolution({ step }: SlideProps) {
  const legends = [
    {
      icon: "cpu",
      title: "SILICON",
      body: "Behind the lens sits the CMOS image sensor — a silicon chip that turns light into pixels.",
    },
    {
      icon: "fingerprint",
      title: "IMPURITY → PUF",
                  body: "Random manufacturing defects leave a unique noise pattern. That Physical Unclonable Function becomes the camera's crypto identity.",
    },
    {
      icon: "scan-line",
      title: "OSD NONCE",
      body: "Server sends a one-time code; the camera burns it onto the live JPEG. OCR must read it back — proves right now, not a replay.",
    },
  ] as const;

  return (
    <>
      <Viewfinder />
      <div className="shell top sol-teach">
        <div className="kicker enter-up">HOW IT WORKS</div>
        <h2 className="headline wide enter-up d1">
          Silicon impurity → camera ID → live nonce.
        </h2>
        <p className="lede enter-up d2 sol-teach-lede">
          Like a camera cutaway, but we zoom into the chip: impurities make the
          fingerprint (PUF), then a live nonce proves the frame is fresh.
        </p>

        <div className="puf-diagram enter-scale d3">
          <img
            src={`${A}/cmos-puf-explainer.jpg`}
            alt="How CMOS PUF works: camera cross-section, silicon impurities, PUF extraction, live OSD nonce"
          />
        </div>

        <div className="puf-legend">
          {legends.map((item, i) => (
            <Frag key={item.title} show={step > i} className="puf-legend-card">
              <span className="ico-well copper">
                <img src={`${A}/icons/${item.icon}.svg`} alt="" />
              </span>
              <div>
                <div className="puf-legend-title">{item.title}</div>
                <div className="puf-legend-body">{item.body}</div>
              </div>
            </Frag>
          ))}
        </div>
      </div>
    </>
  );
}

const PIPELINE = [
  {
    num: "01",
    name: "ENROLL",
    detail: "CMOS PUF + BCH",
    icon: "fingerprint",
    say: "Capture silicon noise → stabilize with BCH → camera account from this chip.",
    fns: "enroll_from_camera · BCH helper · majority vote · IRCUT settle",
  },
  {
    num: "02",
    name: "BOND",
    detail: "10 ℏ escrow",
    icon: "lock",
    say: "Lock HBAR into the escrow vault — no bond, no enrollment.",
    fns: "lockCameraEscrow · HEDERA_ESCROW_ACCOUNT · slash on fraud",
  },
  {
    num: "03",
    name: "CHALLENGE",
    detail: "nonce + OSD",
    icon: "radio",
    say: "Burn a fresh one-time code into the live frame via camera OSD.",
    fns: "issueNonce · set_osd_text · ocr_osd_nonce · OSD crop OCR",
  },
  {
    num: "04",
    name: "WITNESS",
    detail: "PUF regen + PRNU",
    icon: "eye",
    say: "Re-derive the chip key on-device; PRNU proves the same physical sensor.",
    fns: "respond_to_challenge · fx_regenerate · prnu_correlate · assert_physical_device",
  },
  {
    num: "05",
    name: "DETECT",
    detail: "YOLO evidence",
    icon: "scan-search",
    say: "Count stock on the same OSD-bound JPEG the challenge just signed.",
    fns: "vision/detect · yolov8n-stock · imageHash on attested frame",
  },
  {
    num: "06",
    name: "VERIFY",
    detail: "sig + hashes",
    icon: "badge-check",
    say: "Check signature, silicon match, nonce freshness, and image hash.",
    fns: "verifyAttestation · cmos_score · osdMatch · modelHash",
  },
  {
    num: "07",
    name: "PUBLISH",
    detail: "Hedera HCS",
    icon: "radio-tower",
    say: "Anchor attestation.v1 on Hedera — buyers unlock via x402.",
    fns: "publishAttestationToHcs · is_fake slash · restake to resume",
  },
] as const;

function SlidePipeline({ step }: SlideProps) {
  const active = step > 0 ? PIPELINE[Math.min(step, 7) - 1] : null;
  return (
    <>
      <Viewfinder />
      <div className="shell top">
        <div className="kicker enter-up">TRUST PIPELINE</div>
        <h2 className="headline enter-up d1">
          From enroll to on-chain proof.
        </h2>
        <p className="lede enter-up d2 pipe-lede">
          Seven steps: lock the camera’s silicon ID, challenge it live, count
          stock on that frame, then publish — each stage blocks a different fake.
        </p>
        <div className="rail-wrap">
          <div className="rail-line">
            <div
              className="fill"
              style={{ width: `${Math.min(100, (step / 7) * 100)}%` }}
            />
          </div>
          <div className="rail">
            {PIPELINE.map((item, i) => (
              <Frag
                key={item.num}
                show={step > i}
                className={`stage${step === i + 1 ? " stage-hot" : ""}`}
              >
                <div className="num">{item.num}</div>
                <div className="stage-ico" aria-hidden>
                  <img src={`${A}/icons/${item.icon}.svg`} alt="" />
                </div>
                <div className="name">{item.name}</div>
                <div className="detail">{item.detail}</div>
              </Frag>
            ))}
          </div>
        </div>
        <div className={`pipe-cue${active ? " is-on" : ""}`} aria-live="polite">
          {active ? (
            <>
              <span className="pipe-cue-num">{active.num}</span>
              <div className="pipe-cue-body">
                <span className="pipe-cue-say">{active.say}</span>
                <span className="pipe-cue-fns">{active.fns}</span>
              </div>
            </>
          ) : (
            <span className="pipe-cue-say dim">
              Tap forward — enroll → bond → OSD challenge → PUF witness → YOLO →
              verify → HCS.
            </span>
          )}
        </div>
      </div>
    </>
  );
}

const LAYERS = [
  {
    name: "CMOS PUF",
    desc: "Camera identity from silicon impurities",
    icon: "fingerprint",
    say: "Manufacturing noise → BCH helper → crypto account for this chip.",
    fns: "enroll_from_camera · puf_fuzzy_extractor",
  },
  {
    name: "OSD NONCE",
    desc: "One-time code burned into the JPEG",
    icon: "scan-line",
    say: "Server challenge written on-camera; OCR must recover it from the frame.",
    fns: "set_osd_text · ocr_osd_nonce",
  },
  {
    name: "PRNU MATCH",
    desc: "Second fingerprint from sensor noise",
    icon: "layers",
    say: "Independent of the signing key — catches camera swaps and replays.",
    fns: "noise_residual · prnu_correlate",
  },
  {
    name: "PUF REGEN",
    desc: "Same sensor regenerates the same key",
    icon: "cpu",
    say: "IRCUT + majority vote + BCH — wrong device cannot re-derive.",
    fns: "respond_to_challenge · fx_regenerate",
  },
  {
    name: "SYNTHETIC GATE",
    desc: "Reject stubs and replayed JPEGs",
    icon: "alert",
    say: "Fake-cam / phone uploads fail closed before signing.",
    fns: "assert_physical_device · is_fake flag",
  },
  {
    name: "SIG + HASH",
    desc: "Integrity of image and attestation",
    icon: "hash",
    say: "Edit the bytes after capture and verification fails.",
    fns: "secp256k1 sign · imageHash · modelHash",
  },
  {
    name: "HCS + BOND",
    desc: "On-chain log + 10 ℏ economic stake",
    icon: "lock",
    say: "Anchor on Hedera; slash the bond on fraud; restake to resume.",
    fns: "publishAttestationToHcs · slashCameraForFraud",
  },
  {
    name: "x402 UNLOCK",
    desc: "Pay-per-query access to evidence",
    icon: "credit-card",
    say: "Buyers pay to open the attested proof — no free silent peek.",
    fns: "requireX402Payment · Blocky402 settle",
  },
] as const;

function SlideStack({ step }: SlideProps) {
  const active = step > 0 ? LAYERS[Math.min(step, LAYERS.length) - 1] : null;
  return (
    <>
      <Viewfinder />
      <div className="shell top">
        <div className="kicker enter-up">ANTI-FAKE</div>
        <h2 className="headline wide enter-up d1">
          Not one proof. A stack of proofs.
        </h2>
        <p className="lede enter-up d2 stack-lede">
          After you know silicon → PUF → nonce, here is every layer that still
          has to pass — each blocks a different cheat.
        </p>
        <div className="stack stack-grid">
          {LAYERS.map((item, i) => (
            <Frag
              key={item.name}
              show={step > i}
              className={`layer layer-card${step === i + 1 ? " layer-hot" : ""}`}
            >
              <div className="layer-ico" aria-hidden>
                <img src={`${A}/icons/${item.icon}.svg`} alt="" />
              </div>
              <div className="layer-copy">
                <div className="lname">{item.name}</div>
                <div className="ldesc">{item.desc}</div>
              </div>
              <div className="layer-idx">{String(i + 1).padStart(2, "0")}</div>
            </Frag>
          ))}
        </div>
        <div
          className={`pipe-cue stack-cue${active ? " is-on" : ""}`}
          aria-live="polite"
        >
          {active ? (
            <>
              <span className="pipe-cue-num">
                {String(Math.min(step, LAYERS.length)).padStart(2, "0")}
              </span>
              <div className="pipe-cue-body">
                <span className="pipe-cue-say">{active.say}</span>
                <span className="pipe-cue-fns">{active.fns}</span>
              </div>
            </>
          ) : (
            <span className="pipe-cue-say dim">
              Tap forward — each layer names the defense function.
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function SlideWho(_p: SlideProps) {
  return (
    <>
      <div className="who-split">
        <div className="who-panel who-fake enter-left">
          <img
            src={`${A}/fake-cam-live.jpg`}
            alt="Fake camera stub frame"
            className="who-bg"
          />
          <div className="who-veil fake" />
          <div className="who-panel-body">
            <div className="who-stamp reject">
              <img src={`${A}/icons/circle-x.svg`} alt="" />
              FAKE CAM
            </div>
            <div className="who-k">ISAPI STUB · NO CMOS</div>
            <h3 className="who-title">Looks like a feed.</h3>
            <p className="who-copy">
              Phone photo, replay, or stub stream — no physical CMOS fingerprint.
            </p>
            <ul className="who-bullets">
              <li>
                <img src={`${A}/icons/x.svg`} alt="" />
                No silicon impurity / PUF match
              </li>
              <li>
                <img src={`${A}/icons/x.svg`} alt="" />
                Replay / upload fools software keys
              </li>
              <li>
                <img src={`${A}/icons/alert.svg`} alt="" />
                Flagged Unverified
              </li>
            </ul>
          </div>
        </div>

        <div className="who-mid enter-up d2">
          <div className="who-mid-kicker">WHO USES IT</div>
          <h2 className="who-mid-h">Evidence layer for B2B stock.</h2>
          <div className="who-mid-roles">
            <div>
              <div className="who-role">SUPPLIER</div>
              <ol>
                <li>Enroll camera</li>
                <li>Show stock</li>
                <li>Attest</li>
                <li>Fulfill</li>
              </ol>
            </div>
            <div className="who-mid-vs">→</div>
            <div>
              <div className="who-role">BUYER</div>
              <ol>
                <li>Request</li>
                <li>x402 unlock</li>
                <li>Verify</li>
                <li>Order</li>
              </ol>
            </div>
          </div>
          <p className="who-mid-note">Not remittance / escrow — proof only.</p>
        </div>

        <div className="who-panel who-real enter-right d1">
          <img
            src={`${A}/hik-live.jpg`}
            alt="Real Hikvision live frame"
            className="who-bg"
          />
          <div className="who-veil real" />
          <div className="who-panel-body">
            <div className="who-stamp accept">
              <img src={`${A}/icons/shield-check.svg`} alt="" />
              REAL CMOS
            </div>
            <div className="who-k">HIKVISION · DS-2CD1323G0E-I</div>
            <h3 className="who-title">Same frame. Proven silicon.</h3>
            <p className="who-copy">
              Live OSD nonce on a bonded camera — buyers unlock attested stock.
            </p>
            <ul className="who-bullets good">
              <li>
                <img src={`${A}/icons/check.svg`} alt="" />
                CMOS PUF identity
              </li>
              <li>
                <img src={`${A}/icons/check.svg`} alt="" />
                Fresh OSD challenge on the frame
              </li>
              <li>
                <img src={`${A}/icons/check.svg`} alt="" />
                Hedera HCS + x402 unlock
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function SlideShipped(_p: SlideProps) {
  return (
    <>
      <Viewfinder />
      <div className="shell top">
        <div className="kicker enter-up">WHAT&apos;S ACTUALLY SHIPPED</div>
        <h2 className="headline enter-up d1">We built the path.</h2>
        <div className="metrics">
          <div className="metric enter-up d2">
            <div className="val">10 ℏ</div>
            <div className="unit">CAMERA BOND</div>
          </div>
          <div className="metric enter-up d3">
            <div className="val">~0.01</div>
            <div className="unit">x402 QUERY (ℏ)</div>
          </div>
          <div className="metric enter-up d4">
            <div className="val">2 MIN</div>
            <div className="unit">NONCE TTL</div>
          </div>
        </div>
        <div className="shot-strip enter-up d4">
          <div className="shot">
            <img src={`${A}/ui-login.png`} alt="Login" />
            <div className="cap">LOGIN</div>
          </div>
          <div className="shot">
            <img src={`${A}/ui-attestation.png`} alt="Attestation" />
            <div className="cap">ATTESTATION</div>
          </div>
          <div className="shot">
            <img src={`${A}/ui-x402-unlock.png`} alt="x402" />
            <div className="cap">x402 · 0.01 ℏ</div>
          </div>
        </div>
        <div className="tech-row enter-up d5">
          <span className="tech">NEXT.JS</span>
          <span className="tech-plus">+</span>
          <span className="tech">FASTAPI + YOLO</span>
          <span className="tech-plus">+</span>
          <span className="tech">HEDERA HCS</span>
          <span className="tech-plus">+</span>
          <span className="tech">x402</span>
          <span className="tech-plus">+</span>
          <span className="tech">FAKE-CAM TESTING</span>
        </div>
      </div>
    </>
  );
}

function SlideClose(_p: SlideProps) {
  return (
    <>
      <div className="close-frame">
        <img className="close-photo" src={`${A}/hik-live.jpg`} alt="" />
        <div className="close-veil" />
        <div className="close-scan" aria-hidden />
        <Viewfinder />
        <div className="close-shell">
          <div className="close-brand enter-up">
            <span className="close-mark" aria-hidden />
            ShelfSign
          </div>
          <h2 className="close-headline enter-up d1">
            Stock you can verify
            <span className="headline-break"> from the silicon up.</span>
          </h2>
          <p className="close-sub enter-up d2">
            This chip. This nonce. Signed proof buyers can unlock.
          </p>
          <div className="close-cta enter-up d3">
            <span className="close-cta-label">Next</span>
            <span className="close-cta-main">Let&apos;s attest a shelf.</span>
            <span className="close-cta-rule" aria-hidden />
          </div>
          <ul className="close-proofs enter-up d4">
            <li>
              <img src={`${A}/icons/fingerprint.svg`} alt="" />
              <span className="close-proof-lab">CMOS PUF</span>
              <span className="close-proof-hint">chip ID</span>
            </li>
            <li>
              <img src={`${A}/icons/scan-line.svg`} alt="" />
              <span className="close-proof-lab">OSD NONCE</span>
              <span className="close-proof-hint">right now</span>
            </li>
            <li>
              <img src={`${A}/icons/layers.svg`} alt="" />
              <span className="close-proof-lab">PRNU</span>
              <span className="close-proof-hint">noise match</span>
            </li>
            <li>
              <img src={`${A}/icons/cpu.svg`} alt="" />
              <span className="close-proof-lab">BCH</span>
              <span className="close-proof-hint">stable key</span>
            </li>
            <li>
              <img src={`${A}/icons/radio-tower.svg`} alt="" />
              <span className="close-proof-lab">HCS</span>
              <span className="close-proof-hint">on-chain</span>
            </li>
            <li>
              <img src={`${A}/icons/credit-card.svg`} alt="" />
              <span className="close-proof-lab">x402</span>
              <span className="close-proof-hint">pay to see</span>
            </li>
          </ul>
          <div className="close-meta enter-up d5">
            <span className="live-dot" />
            HIKVISION DS-2CD1323G0E-I · LIVE FRAME
          </div>
        </div>
      </div>
    </>
  );
}

const SLIDES: {
  id: string;
  steps: number;
  bleed?: boolean;
  render: (p: SlideProps) => ReactNode;
}[] = [
  { id: "hero", steps: 0, render: (p) => <SlideHero {...p} /> },
  { id: "problem", steps: 7, render: (p) => <SlideProblem {...p} /> },
  { id: "why", steps: 11, render: (p) => <SlideWhy {...p} /> },
  { id: "insight", steps: 0, render: (p) => <SlideInsight {...p} /> },
  { id: "solution", steps: 3, render: (p) => <SlideSolution {...p} /> },
  { id: "pipeline", steps: 7, render: (p) => <SlidePipeline {...p} /> },
  { id: "stack", steps: 8, render: (p) => <SlideStack {...p} /> },
  { id: "who", steps: 0, bleed: true, render: (p) => <SlideWho {...p} /> },
  { id: "shipped", steps: 0, render: (p) => <SlideShipped {...p} /> },
  { id: "close", steps: 0, bleed: true, render: (p) => <SlideClose {...p} /> },
];

export default function PitchDeck() {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wantFullscreen, setWantFullscreen] = useState(false);
  const touchX = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const slide = SLIDES[index];
  const maxStep = slide.steps;

  const go = useCallback(
    (dir: 1 | -1) => {
      if (dir === 1) {
        if (step < maxStep) {
          setStep((s) => s + 1);
          return;
        }
        if (index < SLIDES.length - 1) {
          setIndex((i) => i + 1);
          setStep(0);
        }
        return;
      }
      if (step > 0) {
        setStep((s) => s - 1);
        return;
      }
      if (index > 0) {
        const prev = index - 1;
        setIndex(prev);
        setStep(SLIDES[prev].steps);
      }
    },
    [index, step, maxStep],
  );

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* browser may block without gesture */
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fullscreen") === "1" || params.get("fs") === "1") {
      setWantFullscreen(true);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowRight" ||
        e.key === " " ||
        e.key === "PageDown" ||
        e.key === "Enter"
      ) {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") {
        setIndex(0);
        setStep(0);
      } else if (e.key === "End") {
        setIndex(SLIDES.length - 1);
        setStep(0);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void toggleFullscreen();
      } else if (e.key === "Escape" && wantFullscreen && !document.fullscreenElement) {
        setWantFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, toggleFullscreen, wantFullscreen]);

  useEffect(() => {
    const next = `${window.location.pathname}${window.location.search}#/${index}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
      history.replaceState(null, "", next);
    }
  }, [index]);

  useEffect(() => {
    const m = window.location.hash.match(/^#\/(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 0 && n < SLIDES.length) setIndex(n);
    }
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx =
      (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 48) return;
    go(dx < 0 ? 1 : -1);
  };

  const progress = useMemo(
    () =>
      ((index + (maxStep ? step / (maxStep + 1) : 0)) / SLIDES.length) * 100,
    [index, step, maxStep],
  );

  const enterFullscreenFromGate = () => {
    setWantFullscreen(false);
    void toggleFullscreen();
  };

  return (
    <div
      ref={rootRef}
      className={`pitch${isFullscreen ? " is-fullscreen" : ""}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="presentation"
    >
      <div className="fx-layer" aria-hidden>
        <div className="fx-vignette" />
        <div className="fx-grid" />
        <div className="fx-trace" />
        <div className="fx-scan" />
        <div className="fx-grain" />
      </div>

      <div className="pitch-stage">
        {SLIDES.map((s, i) => {
          const active = i === index;
          const cls = [
            "pitch-slide",
            active ? "is-active" : "",
            i < index ? "is-prev" : i > index ? "is-future" : "",
            s.bleed ? "bleed" : "",
          ]
            .filter(Boolean)
            .join(" ");
          // Keep all slides mounted (no remount flash). Prev slides stay fully revealed.
          const renderStep = active ? step : i < index ? s.steps : 0;
          return (
            <section key={s.id} className={cls} aria-hidden={!active}>
              {s.render({ step: renderStep })}
            </section>
          );
        })}
      </div>

      <div className="pitch-progress" aria-hidden>
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className="pitch-nav">
        <button
          type="button"
          aria-label="Previous"
          disabled={index === 0 && step === 0}
          onClick={() => go(-1)}
        >
          ‹
        </button>
        <span>
          {index + 1} / {SLIDES.length}
        </span>
        <button
          type="button"
          aria-label="Next"
          disabled={index === SLIDES.length - 1 && step >= maxStep}
          onClick={() => go(1)}
        >
          ›
        </button>
        <button
          type="button"
          className="pitch-fs-btn"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={isFullscreen}
          title="Fullscreen (F)"
          onClick={() => void toggleFullscreen()}
        >
          {isFullscreen ? "Exit" : "Full"}
        </button>
      </div>

      {wantFullscreen && !isFullscreen ? (
        <div className="pitch-fs-gate">
          <button
            type="button"
            className="pitch-fs-gate-btn"
            onClick={enterFullscreenFromGate}
          >
            Open fullscreen
          </button>
          <p className="pitch-fs-gate-hint">
            Or press <kbd>F</kbd> · Esc to skip
          </p>
        </div>
      ) : null}
    </div>
  );
}
