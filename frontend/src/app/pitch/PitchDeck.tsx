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
              Camera-backed stock, signed from the silicon — attested with a
              live nonce.
            </p>
            <div className="ticker enter-up d3">
              cam_cmos · nonce · imageHash · HCS
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
        <div className="insight-compare">
          <div className="insight-box enter-left d2">
            <div className="lab">SOFTWARE KEY</div>
            <p className="body">“Someone with the key signed this.”</p>
          </div>
          <div className="insight-vs enter-up d3">VS</div>
          <div className="insight-box hot enter-right d3">
            <div className="lab">CAMERA + LIVE NONCE</div>
            <p className="body">
              “THIS identified camera answered THIS challenge.”
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function SlideSolution({ step }: SlideProps) {
  const flow = [
    { label: "CAMERA", icon: "camera" },
    { label: "SILICON ID", icon: "fingerprint" },
    { label: "LIVE NONCE", icon: "scan-line" },
    { label: "VISION", icon: "scan-search" },
    { label: "VERIFY", icon: "badge-check" },
    { label: "HEDERA HCS", icon: "radio-tower" },
  ] as const;

  return (
    <>
      <Viewfinder />
      <div className="shell top">
        <div className="kicker enter-up">SHELFSIGN</div>
        <h2 className="headline wide enter-up d1">
          Live stock from this camera, right now.
        </h2>
        <div className="promise-row">
          <Frag show={step > 0} className="glow-chip">
            <img src={`${A}/icons/camera.svg`} alt="" aria-hidden />
            THIS CAMERA
          </Frag>
          <Frag show={step > 1} className="glow-chip">
            <img src={`${A}/icons/radio.svg`} alt="" aria-hidden />
            RIGHT NOW
          </Frag>
        </div>
        <div className="flow enter-up d3">
          {flow.map((n, i) => (
            <span key={n.label} className="flow-item">
              {i > 0 ? <span className="arr">→</span> : null}
              <span className="node">
                <span className="node-ico" aria-hidden>
                  <img src={`${A}/icons/${n.icon}.svg`} alt="" />
                </span>
                {n.label}
              </span>
            </span>
          ))}
        </div>
        <div className="solution-media enter-scale d4">
          <img
            src={`${A}/ui-stock-detail.png`}
            alt="Buyer stock with live camera"
          />
          <div className="cap">
            REAL UI · BUYER STOCK · CMOS SCORE · LIVE FEED
          </div>
        </div>
      </div>
    </>
  );
}

const PIPELINE = [
  {
    num: "01",
    name: "ENROLL",
    detail: "CMOS / PUF",
    icon: "fingerprint",
    say: "Lock this physical camera’s silicon identity.",
  },
  {
    num: "02",
    name: "BOND",
    detail: "10 HBAR",
    icon: "lock",
    say: "Stake 10 ℏ — economic skin in the game.",
  },
  {
    num: "03",
    name: "CHALLENGE",
    detail: "nonce + OSD",
    icon: "radio",
    say: "Burn a fresh nonce into the live frame.",
  },
  {
    num: "04",
    name: "WITNESS",
    detail: "CMOS match",
    icon: "eye",
    say: "Prove the same sensor answered.",
  },
  {
    num: "05",
    name: "DETECT",
    detail: "YOLO evidence",
    icon: "scan-search",
    say: "Read stock from that camera frame.",
  },
  {
    num: "06",
    name: "VERIFY",
    detail: "sig + hash",
    icon: "badge-check",
    say: "Check signature and image integrity.",
  },
  {
    num: "07",
    name: "PUBLISH",
    detail: "Hedera HCS",
    icon: "radio-tower",
    say: "Anchor the proof on Hedera HCS.",
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
          Seven stages. One physical root.
        </h2>
        <p className="lede enter-up d2 pipe-lede">
          Point at each icon — camera → silicon → live challenge → evidence →
          chain.
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
              <span className="pipe-cue-say">{active.say}</span>
            </>
          ) : (
            <span className="pipe-cue-say dim">
              Tap forward to walk the trust path.
            </span>
          )}
        </div>
      </div>
    </>
  );
}

const LAYERS = [
  {
    name: "CMOS",
    desc: "Physical camera identity",
    icon: "fingerprint",
    say: "Silicon proves which camera shot this.",
  },
  {
    name: "NONCE / OSD",
    desc: "Freshness burned into the live frame",
    icon: "scan-line",
    say: "A live challenge — not a replayed photo.",
  },
  {
    name: "SIGN + HASH",
    desc: "Integrity of image and signature",
    icon: "hash",
    say: "Tamper with the bytes and it fails.",
  },
  {
    name: "HCS LOG",
    desc: "Auditable Hedera record",
    icon: "scroll",
    say: "The proof is anchored on-chain.",
  },
  {
    name: "MODEL HASH",
    desc: "Vision provenance",
    icon: "file-digit",
    say: "Which detector produced this evidence.",
  },
  {
    name: "FRAUD FLAG",
    desc: "Suspicious evidence → Unverified",
    icon: "alert",
    say: "Fake or mismatch → flagged, not trusted.",
  },
  {
    name: "10 ℏ BOND",
    desc: "Economic commitment on enroll",
    icon: "lock",
    say: "Skin in the game to enroll a camera.",
  },
  {
    name: "x402",
    desc: "Pay-per-query access to evidence",
    icon: "credit-card",
    say: "Buyers pay to unlock the attested proof.",
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
          Eight layers. Point at any card — each one blocks a different fake.
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
              <span className="pipe-cue-say">{active.say}</span>
            </>
          ) : (
            <span className="pipe-cue-say dim">
              Tap forward — each layer is a different defense.
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
              Phone photo, replay, or stub stream — fails silicon match.
            </p>
            <ul className="who-bullets">
              <li>
                <img src={`${A}/icons/x.svg`} alt="" />
                No physical sensor ID
              </li>
              <li>
                <img src={`${A}/icons/x.svg`} alt="" />
                Replay / upload accepted by software trust
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
              Live nonce on a bonded camera — buyers unlock attested stock.
            </p>
            <ul className="who-bullets good">
              <li>
                <img src={`${A}/icons/check.svg`} alt="" />
                Physical CMOS identity
              </li>
              <li>
                <img src={`${A}/icons/check.svg`} alt="" />
                Fresh OSD challenge
              </li>
              <li>
                <img src={`${A}/icons/check.svg`} alt="" />
                Hedera HCS + x402 access
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function SlideDemo({ step }: SlideProps) {
  return (
    <>
      <Viewfinder />
      <Hud>DEMO PATH</Hud>
      <div className="shell top">
        <div className="kicker enter-up">LIVE DEMO</div>
        <h2 className="headline wide enter-up d1">
          Let&apos;s try to break the proof.
        </h2>
        <div className="demo-stage">
          <div className="device enter-scale d2">
            <div className="chrome">
              <i />
              <i />
              <i />
            </div>
            <img src={`${A}/ui-live-view.png`} alt="Live camera view" />
            <div className="badge">01 · ENROLL · LIVE VIEW</div>
          </div>
          <div className="demo-side">
            <div className="mini-device enter-right d3">
              <img src={`${A}/ui-stock-detail.png`} alt="Stock detail" />
              <div className="badge">02 · ATTEST</div>
            </div>
            <div className="mini-device enter-right d4">
              <img src={`${A}/ui-x402-unlock.png`} alt="x402 unlock" />
              <div className="badge">03 · x402 UNLOCK</div>
            </div>
          </div>
        </div>
        <div className="break-row">
          <Frag show={step > 0} className="break-badge">
            <span>REPLAY</span>
            <span className="mark">✕</span>
          </Frag>
          <Frag show={step > 1} className="break-badge">
            <span>FAKE CAMERA</span>
            <span className="mark">✕</span>
          </Frag>
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
            This camera. Right now. Signed proof buyers can unlock.
          </p>
          <div className="close-cta enter-up d3">
            <span className="close-cta-label">Next</span>
            <span className="close-cta-main">Let&apos;s attest a shelf.</span>
            <span className="close-cta-rule" aria-hidden />
          </div>
          <ul className="close-proofs enter-up d4">
            <li>
              <img src={`${A}/icons/fingerprint.svg`} alt="" />
              CMOS
            </li>
            <li>
              <img src={`${A}/icons/scan-line.svg`} alt="" />
              LIVE NONCE
            </li>
            <li>
              <img src={`${A}/icons/radio-tower.svg`} alt="" />
              HEDERA HCS
            </li>
            <li>
              <img src={`${A}/icons/credit-card.svg`} alt="" />
              x402
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
  { id: "solution", steps: 2, render: (p) => <SlideSolution {...p} /> },
  { id: "pipeline", steps: 7, render: (p) => <SlidePipeline {...p} /> },
  { id: "stack", steps: 8, render: (p) => <SlideStack {...p} /> },
  { id: "who", steps: 0, bleed: true, render: (p) => <SlideWho {...p} /> },
  { id: "demo", steps: 2, render: (p) => <SlideDemo {...p} /> },
  { id: "shipped", steps: 0, render: (p) => <SlideShipped {...p} /> },
  { id: "close", steps: 0, bleed: true, render: (p) => <SlideClose {...p} /> },
];

export default function PitchDeck() {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const touchX = useRef<number | null>(null);

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    const hash = `#/${index}`;
    if (window.location.hash !== hash) {
      history.replaceState(null, "", hash);
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

  return (
    <div
      className="pitch"
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
      </div>
    </div>
  );
}
