"use client";

import { useState } from "react";
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
  };
}

type Phase = "idle" | "challenging" | "attesting" | "done" | "failed";

const PHASE_COPY: Record<Exclude<Phase, "idle" | "done" | "failed">, string> = {
  challenging: "Generating a fresh attestable nonce…",
  attesting: "SiliconWitness challenge → YOLO frame evidence…",
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [nonce, setNonce] = useState<string | null>(null);
  const [expiresInMs, setExpiresInMs] = useState<number | null>(null);
  const [result, setResult] = useState<AttestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "challenging" || phase === "attesting";
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

  async function runAttestation() {
    setError(null);
    setPhase("attesting");
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

      const attested = await apiPost<AttestResult>(
        `/cameras/${camera.id}/attest`,
        { nonce: activeNonce },
      );
      setResult(attested);
      setPhase("done");
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attestation failed.");
      setPhase("failed");
    }
  }

  return (
    <Overlay onClose={busy ? () => undefined : onClose} wide>
      <div className="overlay-title">Attest live stock</div>
      <div className="overlay-sub">
        {camera.label}
        {camera.enrollment_status === "enrolled"
          ? " · CMOS enrolled"
          : " · camera must be enrolled first"}
      </div>

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
        <li data-done={phase === "done"} data-active={phase === "attesting"}>
          <strong>2. SiliconWitness challenge</strong>
          <p>
            Drive OSD nonce + IR/brightness, regenerate the PUF signing key, and
            verify the silicon identity matches enrollment.
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
              {typeof result.steps.cmosMatch.correctedBitErrors ===
                "number" && (
                <>
                  {" · "}
                  BCH corrections{" "}
                  <span className="mono">
                    {result.steps.cmosMatch.correctedBitErrors}
                  </span>
                </>
              )}
            </div>
          )}
        </li>
        <li data-done={phase === "done"} data-active={phase === "attesting"}>
          <strong>3. YOLO / PyTorch frame evidence</strong>
          <p>
            How many objects the model saw in this frame — evidence only.
            Declared warehouse stock (what buyers can order) is set separately
            and is not overwritten here.
          </p>
          {phase === "done" && (
            <div className="attest-readout">
              Detected in frame: <span className="mono">{totalUnits}</span>{" "}
              units
              {result?.steps.detection?.detectionCount != null
                ? ` · ${result.steps.detection.detectionCount} boxes`
                : ""}
              {result?.steps.detection?.engine
                ? ` · ${result.steps.detection.engine}`
                : ""}
            </div>
          )}
        </li>
      </ol>

      {(phase === "challenging" || phase === "attesting") && (
        <div className="attest-progress" role="status" aria-live="polite">
          {PHASE_COPY[phase]}
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

      {phase === "done" && items.length === 0 && (
        <div className="row-sub" style={{ marginBottom: 16 }}>
          Attestation saved, but YOLO found no stock classes in this frame.
          Point the camera at shelf inventory and try again.
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
              disabled={busy || camera.enrollment_status !== "enrolled"}
            >
              {nonce ? "New nonce" : "Generate nonce"}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={runAttestation}
              disabled={busy || camera.enrollment_status !== "enrolled"}
            >
              {phase === "attesting" ? "Attesting…" : "Attest now"}
            </button>
          </>
        )}
      </div>
    </Overlay>
  );
}
