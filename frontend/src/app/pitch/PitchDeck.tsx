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

function SlideProblem(_p: SlideProps) {
  const doubts = [
    { q: "Current?", icon: "clock" },
    { q: "This warehouse?", icon: "warehouse" },
    { q: "This camera?", icon: "camera" },
    { q: "Right now?", icon: "scan-line" },
  ] as const;

  const solves = [
    { q: "This camera", icon: "fingerprint" },
    { q: "Live nonce", icon: "scan-line" },
    { q: "Signed frame", icon: "shield-check" },
    { q: "Buyer unlock", icon: "credit-card" },
  ] as const;

  return (
    <>
      <Viewfinder />
      <div className="shell top problem-solve-shell">
        <div className="kicker enter-up">THE BUYER PROBLEM</div>
        <div className="ps-title-row enter-up d1">
          <h2 className="headline wide ps-headline">
            Trust breaks before the order.
          </h2>
          <p className="ps-lede">
            Buyers get warehouse photos and camera frames with no proof they are
            live, local, or from the enrolled sensor. ShelfSign answers with
            silicon identity + a fresh challenge.
          </p>
        </div>

        <div className="ps-tri enter-up d2">
          <figure className="ps-tile bad">
            <img src={`${A}/warehouse-unsplash.jpg`} alt="Warehouse aisle photo" />
            <figcaption>
              <span className="ps-flag bad">UNVERIFIED</span>
              <strong>Warehouse photo</strong>
              <em>Looks full — no live proof</em>
            </figcaption>
          </figure>
          <figure className="ps-tile bad">
            <img src={`${A}/fake-cam-live.jpg`} alt="Fake camera or phone frame" />
            <figcaption>
              <span className="ps-flag bad">UNVERIFIED</span>
              <strong>Camera / phone frame</strong>
              <em>Any device · any replay</em>
            </figcaption>
          </figure>
          <figure className="ps-tile good">
            <img src={`${A}/hik-live.jpg`} alt="Live bonded camera frame" />
            <figcaption>
              <span className="ps-flag good">VERIFIED</span>
              <strong>Bonded live frame</strong>
              <em>Silicon · nonce · right now</em>
            </figcaption>
          </figure>
        </div>

        <div className="ps-rails enter-up d3">
          <div className="ps-rail bad">
            <span className="ps-rail-lab">Buyers can&apos;t know</span>
            <div className="ps-rail-items">
              {doubts.map((d) => (
                <span key={d.q} className="ps-pill bad">
                  <img src={`${A}/icons/${d.icon}.svg`} alt="" />
                  {d.q}
                </span>
              ))}
            </div>
          </div>
          <div className="ps-rail good">
            <span className="ps-rail-lab">ShelfSign proves</span>
            <div className="ps-rail-items">
              {solves.map((s) => (
                <span key={s.q} className="ps-pill good">
                  <img src={`${A}/icons/${s.icon}.svg`} alt="" />
                  {s.q}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SlideSolution(_p: SlideProps) {
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
          Live demo covers enroll → attest → chain. Here is the chip idea in one
          frame: impurities make the fingerprint (PUF), then a live nonce proves
          the frame is fresh.
        </p>

        <div className="puf-diagram enter-scale d3">
          <img
            src={`${A}/cmos-puf-explainer.jpg`}
            alt="How CMOS PUF works: camera cross-section, silicon impurities, PUF extraction, live OSD nonce"
          />
        </div>

        <div className="puf-legend">
          {legends.map((item) => (
            <div key={item.title} className="puf-legend-card frag is-shown">
              <span className="ico-well copper">
                <img src={`${A}/icons/${item.icon}.svg`} alt="" />
              </span>
              <div>
                <div className="puf-legend-title">{item.title}</div>
                <div className="puf-legend-body">{item.body}</div>
              </div>
            </div>
          ))}
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
  },
  {
    name: "OSD NONCE",
    desc: "One-time code burned into the JPEG",
    icon: "scan-line",
  },
  {
    name: "PRNU MATCH",
    desc: "Second fingerprint from sensor noise",
    icon: "layers",
  },
  {
    name: "PUF REGEN",
    desc: "Same sensor regenerates the same key",
    icon: "cpu",
  },
  {
    name: "SYNTHETIC GATE",
    desc: "Reject stubs and replayed JPEGs",
    icon: "alert",
  },
  {
    name: "SIG + HASH",
    desc: "Integrity of image and attestation",
    icon: "hash",
  },
  {
    name: "HCS + BOND",
    desc: "On-chain log + 10 ℏ economic stake",
    icon: "lock",
  },
  {
    name: "x402 UNLOCK",
    desc: "Pay-per-query access to evidence",
    icon: "credit-card",
  },
] as const;

function SlideStack(_p: SlideProps) {
  return (
    <>
      <Viewfinder />
      <div className="shell top">
        <div className="kicker enter-up">ANTI-FAKE</div>
        <h2 className="headline wide enter-up d1">
          Not one proof. A stack of proofs.
        </h2>
        <p className="lede enter-up d2 stack-lede">
          Silicon → PUF → nonce is the core. Every layer below still has to pass
          — each blocks a different cheat. Live demo walks the path.
        </p>
        <div className="stack stack-grid">
          {LAYERS.map((item, i) => (
            <div
              key={item.name}
              className="layer layer-card frag is-shown enter-up"
            >
              <div className="layer-ico" aria-hidden>
                <img src={`${A}/icons/${item.icon}.svg`} alt="" />
              </div>
              <div className="layer-copy">
                <div className="lname">{item.name}</div>
                <div className="ldesc">{item.desc}</div>
              </div>
              <div className="layer-idx">{String(i + 1).padStart(2, "0")}</div>
            </div>
          ))}
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
  { id: "problem", steps: 0, render: (p) => <SlideProblem {...p} /> },
  { id: "solution", steps: 0, render: (p) => <SlideSolution {...p} /> },
  { id: "stack", steps: 0, render: (p) => <SlideStack {...p} /> },
  { id: "who", steps: 0, bleed: true, render: (p) => <SlideWho {...p} /> },
  { id: "shipped", steps: 0, render: (p) => <SlideShipped {...p} /> },
  { id: "close", steps: 0, bleed: true, render: (p) => <SlideClose {...p} /> },
];

function initialSlideIndex() {
  if (typeof window === "undefined") return 0;
  const m = window.location.hash.match(/^#\/(\d+)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return n >= 0 && n < SLIDES.length ? n : 0;
}

export default function PitchDeck() {
  const [index, setIndex] = useState(initialSlideIndex);
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
