"use client";

import { useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import { Overlay } from "@/components/ui";
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

type Phase = "idle" | "challenging" | "attesting" | "done" | "failed";

/**
 * Live CMOS attest only. Stake 10 ℏ first via StakeCameraDialog — this wizard
 * verifies the sensor and publishes attestation (camera becomes Verified).
 */
export function AttestWizard({
  camera,
  onClose,
  onComplete,
}: {
  camera: Camera;
  onClose: () => void;
  onComplete?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [nonce, setNonce] = useState<string | null>(null);
  const nonceRef = useRef<string | null>(null);
  const [expiresInMs, setExpiresInMs] = useState<number | null>(null);
  const [result, setResult] = useState<AttestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "challenging" || phase === "attesting";
  const bonded = camera.escrow_status === "locked";
  const items =
    result?.steps.detection?.items ?? result?.attestation.items ?? [];
  const totalUnits =
    result?.steps.totalUnits ??
    result?.steps.detection?.totalUnits ??
    items.reduce((n, i) => n + i.count, 0);

  async function runAttest() {
    setError(null);
    setResult(null);
    try {
      if (!bonded) {
        throw new Error(
          "Stake 10 ℏ first — Attest live requires an active legitimacy bond.",
        );
      }
      setPhase("challenging");
      const issued = await apiPost<{ nonce: string; expiresInMs: number }>(
        "/nonce/challenge",
      );
      nonceRef.current = issued.nonce;
      setNonce(issued.nonce);
      setExpiresInMs(issued.expiresInMs);

      setPhase("attesting");
      const attested = await apiPost<AttestResult>(
        `/cameras/${camera.id}/attest`,
        { nonce: issued.nonce },
      );
      setResult(attested);
      setPhase("done");
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attest failed.");
      setPhase("failed");
      onComplete?.();
    }
  }

  return (
    <Overlay onClose={busy ? () => undefined : onClose} wide>
      <div className="overlay-title">Attest live stock</div>
      <div className="overlay-sub">
        {camera.label}
        {" · "}
        <span className="mono">{camera.host || "no host"}</span>
        {camera.is_fake
          ? " · Unverified"
          : bonded
            ? " · Staked"
            : " · Needs stake"}
        {bonded ? " · Ready to attest" : ""}
      </div>
      <p className="row-sub" style={{ marginBottom: 12 }}>
        Runs CMOS + OSD nonce + YOLO and publishes to Hedera HCS. Buyers see{" "}
        <strong>Verified</strong> only after this succeeds — stake alone is not
        enough. Fraud after Verified slashes the bond; pre-verify failures do
        not.
      </p>

      {!bonded ? (
        <div className="field-error" style={{ marginTop: 0, marginBottom: 16 }}>
          No active 10 ℏ stake. Close this and use <strong>Stake 10 ℏ</strong>{" "}
          first (x402 from your wallet).
        </div>
      ) : null}

      {camera.is_fake ? (
        <div className="field-error" style={{ marginTop: 0, marginBottom: 16 }}>
          Marked Unverified. Stake is still held if this camera was never
          Verified. Attest on a real sensor to clear the flag.
        </div>
      ) : null}

      <ol className="attest-steps">
        <li data-done={!!nonce || phase === "done"}>
          <strong>1. Challenge nonce</strong>
          <p>Server issues a one-time nonce (2‑minute TTL).</p>
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
        <li data-done={phase === "done"} data-active={phase === "attesting"}>
          <strong>2. SiliconWitness + YOLO → HCS</strong>
          <p>OSD nonce, PUF regen, PRNU, stock counts, on-chain publish.</p>
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
            </div>
          )}
          {phase === "done" && (
            <div className="attest-readout">
              Detected in frame: <span className="mono">{totalUnits}</span>{" "}
              units
            </div>
          )}
        </li>
      </ol>

      {phase === "attesting" && (
        <div className="attest-progress" role="status" aria-live="polite">
          Running CMOS challenge → YOLO → HCS…
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
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={runAttest}
            disabled={busy || !bonded}
          >
            {phase === "attesting" ? "Attesting…" : "Attest live"}
          </button>
        )}
      </div>
    </Overlay>
  );
}
