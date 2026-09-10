"use client";

import { useState } from "react";
import { apiPost, apiPostPaid, type X402Challenge } from "@/lib/api";
import { Overlay } from "@/components/ui";
import { PayUnlockDialog } from "@/components/PayUnlockDialog";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { signExactPaymentHeaderWithSigner } from "@/lib/x402Client";
import type { Camera } from "@/app/supplier/SupplierDataContext";

interface StockItem {
  sku: string;
  count: number;
  confidence: number;
  shelf: string;
  category?: string;
}

interface AttestResult {
  attestation: {
    id: string;
    nonce: string;
    image_hash: string;
    model: string;
    items: StockItem[];
    captured_at: string;
  };
  steps: {
    nonce: string;
    cmosMatch?: {
      match?: boolean;
      score?: number;
      correctedBitErrors?: number;
      prnuScore?: number | null;
      prnuMatch?: boolean;
      prnuAvailable?: boolean;
    };
    detection?: {
      items?: StockItem[];
      totalUnits?: number;
      detectionCount?: number;
      engine?: string;
      model?: string;
    };
    totalUnits?: number;
    cmosScore?: number;
    prnuScore?: number | null;
  };
}

type Phase =
  | "idle"
  | "challenging"
  | "paying"
  | "attesting"
  | "done"
  | "failed";

const PHASE_COPY: Record<"challenging" | "paying" | "attesting", string> = {
  challenging: "Generating a fresh attestable nonce…",
  paying: "Waiting for x402 payment…",
  attesting: "SiliconWitness challenge → YOLO frame evidence → HCS…",
};

export function AttestWizard({
  camera,
  onClose,
  onComplete,
}: {
  camera: Camera;
  onClose: () => void;
  onComplete?: () => void;
}) {
  const { getClientSigner } = useHederaWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [nonce, setNonce] = useState<string | null>(null);
  const [expiresInMs, setExpiresInMs] = useState<number | null>(null);
  const [result, setResult] = useState<AttestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payChallenge, setPayChallenge] = useState<X402Challenge | null>(null);
  const [paying, setPaying] = useState(false);

  const busy =
    phase === "challenging" ||
    phase === "paying" ||
    phase === "attesting" ||
    paying;
  const items =
    result?.steps.detection?.items ?? result?.attestation.items ?? [];
  const totalUnits =
    result?.steps.totalUnits ??
    result?.steps.detection?.totalUnits ??
    items.reduce((n, i) => n + i.count, 0);

  async function generateNonce() {
    setError(null);
    setResult(null);
    setPhase("challenging");
    try {
      const challenge = await apiPost<{ nonce: string; expiresInMs: number }>(
        "/nonce/challenge",
      );
      setNonce(challenge.nonce);
      setExpiresInMs(challenge.expiresInMs);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't issue a nonce.");
      setPhase("failed");
    }
  }

  async function startPayAndAttest() {
    setError(null);
    setPhase("paying");
    try {
      let activeNonce = nonce;
      if (!activeNonce) {
        const challenge = await apiPost<{ nonce: string; expiresInMs: number }>(
          "/nonce/challenge",
        );
        activeNonce = challenge.nonce;
        setNonce(challenge.nonce);
        setExpiresInMs(challenge.expiresInMs);
      }

      await apiPostPaid<AttestResult>(
        `/cameras/${camera.id}/attest`,
        { nonce: activeNonce },
        {
          onChallenge: async (challenge) => {
            setPayChallenge(challenge);
            setPayOpen(true);
            return false;
          },
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Attestation failed.";
      if (msg !== "Payment cancelled") {
        setError(msg);
        setPhase("failed");
      } else {
        setPhase("idle");
      }
    }
  }

  async function confirmPayAttest() {
    if (!payChallenge || !nonce) return;
    setPaying(true);
    setError(null);
    setPhase("attesting");
    try {
      const requirements = payChallenge.accepts?.[0];
      if (!requirements) throw new Error("Challenge missing requirements.");
      const signer = await getClientSigner();
      const signed = await signExactPaymentHeaderWithSigner(
        requirements,
        signer,
      );
      const attested = await apiPostPaid<AttestResult>(
        `/cameras/${camera.id}/attest`,
        { nonce },
        { paymentSignature: signed.paymentHeader },
      );
      setResult(attested);
      setPhase("done");
      setPayOpen(false);
      setPayChallenge(null);
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attestation failed.");
      setPhase("failed");
      onComplete?.();
    } finally {
      setPaying(false);
    }
  }

  return (
    <>
      <Overlay onClose={busy ? () => undefined : onClose} wide>
        <div className="overlay-title">Pay & attest live stock</div>
        <div className="overlay-sub">
          {camera.label}
          {" · "}
          <span className="mono">{camera.host || "no host"}</span>
          {camera.is_fake ? " · Unverified camera" : " · Verified camera"}
          {camera.enrollment_status === "enrolled"
            ? " · Enrolled"
            : camera.enrollment_status === "pending"
              ? " · Will re-enroll on attest"
              : " · Enrollment required"}
          {" · x402 required"}
        </div>
        {camera.is_fake ? (
          <div
            className="field-error"
            style={{ marginTop: 0, marginBottom: 16 }}
          >
            This camera is flagged unverified (synthetic stub or failed silicon
            check). Attest must hit a real sensor at the host above — Edit IP /
            login if this still points at Fake Cam (
            <span className="mono">127.0.0.1:8788</span>).
          </div>
        ) : null}

        <ol className="attest-steps">
          <li data-done={!!nonce || phase === "done"}>
            <strong>1. Challenge nonce</strong>
            <p>Server issues a one-time random nonce (2‑minute TTL).</p>
            {nonce && (
              <div className="attest-nonce mono" title={nonce}>
                {nonce}
              </div>
            )}
            {expiresInMs != null && nonce && phase !== "done" && (
              <div className="row-sub">
                Expires in {Math.round(expiresInMs / 1000)}s
              </div>
            )}
          </li>
          <li
            data-done={phase === "done"}
            data-active={phase === "paying" || phase === "attesting"}
          >
            <strong>2. Pay x402 + SiliconWitness challenge</strong>
            <p>
              Settle payment via x402, then drive OSD nonce + IR, regenerate the
              PUF key, and verify silicon identity.
            </p>
            {result?.steps.cmosMatch && (
              <div className="attest-readout">
                Match:{" "}
                <span className="mono">
                  {result.steps.cmosMatch.match ? "yes" : "no"}
                </span>
                {" · "}
                score{" "}
                <span className="mono">
                  {(
                    result.steps.cmosMatch.score ??
                    result.steps.cmosScore ??
                    0
                  ).toFixed(3)}
                </span>
                {result.steps.cmosMatch.prnuAvailable && (
                  <>
                    {" · "}
                    PRNU{" "}
                    <span className="mono">
                      {result.steps.cmosMatch.prnuScore != null
                        ? Number(result.steps.cmosMatch.prnuScore).toFixed(4)
                        : "—"}
                    </span>
                  </>
                )}
              </div>
            )}
          </li>
          <li data-done={phase === "done"} data-active={phase === "attesting"}>
            <strong>3. YOLO evidence → HCS</strong>
            <p>
              Frame evidence only. Declared warehouse stock is set separately.
            </p>
            {phase === "done" && (
              <div className="attest-readout">
                Detected in frame: <span className="mono">{totalUnits}</span>{" "}
                units
              </div>
            )}
          </li>
        </ol>

        {(phase === "challenging" ||
          phase === "paying" ||
          phase === "attesting") && (
          <div className="attest-progress" role="status" aria-live="polite">
            {PHASE_COPY[phase as "challenging" | "paying" | "attesting"]}
          </div>
        )}

        {error && <div className="field-error">{error}</div>}

        {phase === "done" && items.length > 0 && (
          <div className="attest-items">
            <div
              className="overlay-title"
              style={{ fontSize: 14, marginBottom: 10 }}
            >
              Detected in frame (evidence)
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.sku}>
                    <td className="mono">{item.category ?? item.sku}</td>
                    <td className="mono">{item.count}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Sum</strong>
                  </td>
                  <td className="mono">
                    <strong>{totalUnits}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="confirm-actions">
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onClose}
            disabled={busy}
          >
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase !== "done" && (
            <>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={generateNonce}
                disabled={busy || camera.enrollment_status === "failed"}
              >
                {nonce ? "New nonce" : "Generate nonce"}
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={startPayAndAttest}
                disabled={busy || camera.enrollment_status === "failed"}
              >
                {phase === "attesting" || phase === "paying"
                  ? "Pay & attest…"
                  : "Pay & attest live"}
              </button>
            </>
          )}
        </div>
      </Overlay>

      {payOpen && payChallenge && (
        <PayUnlockDialog
          title="Pay & attest live"
          subtitle={`${camera.label} · CMOS + nonce + YOLO → HCS · Hedera x402`}
          confirmVerb="Pay & attest"
          sku={camera.label}
          warehouseName="Live camera attestation"
          challenge={payChallenge}
          busy={paying}
          error={error}
          onConfirm={confirmPayAttest}
          onCancel={() => {
            if (paying) return;
            setPayOpen(false);
            setPayChallenge(null);
            setPhase("idle");
          }}
        />
      )}
    </>
  );
}
