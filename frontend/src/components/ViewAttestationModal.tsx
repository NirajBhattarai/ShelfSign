"use client";

import { useState } from "react";
import { DetailRow, Overlay } from "@/components/ui";
import { FraudFlag } from "@/components/FraudFlag";
import type { StockItem } from "@/app/buyer/BuyerDataContext";

export interface AttestationDetails {
  id: string | null;
  camera_id?: string | null;
  camera_account: string | null;
  camera_label?: string | null;
  nonce: string | null;
  image_hash: string | null;
  model: string | null;
  model_hash: string | null;
  items: StockItem[];
  captured_at: string;
  cmos_score?: number | null;
  hcs_topic_id?: string | null;
  hcs_sequence_number?: number | null;
}

export interface LiveCountResult {
  cameraId: string;
  cameraLabel: string | null;
  items: StockItem[];
  totalUnits: number;
  detectionCount: number;
  model: string;
  engine: string;
  imageHash: string;
  countedAt: string;
  nonce?: string;
  cmosScore?: number;
  attestationId?: string | null;
  steps?: {
    challenge?: {
      match?: boolean;
      osdMatch?: boolean;
      osdDecoded?: string;
      correctedBitErrors?: number;
    };
    cmosMatch?: { match?: boolean; score?: number };
  };
}

interface TrustCheck {
  title: string;
  body: string;
  ok: boolean;
}

function shortHash(value: string | null | undefined, keep = 10): string {
  if (!value) return "—";
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-6)}`;
}

export function ViewAttestationModal({
  title,
  subtitle,
  sku,
  orderableCount,
  detectedCount,
  shelf,
  showFakeFlag,
  trustChecks,
  attestation,
  attestedItems,
  liveCount,
  counting,
  countError,
  countLiveLabel,
  countLiveBusy,
  countLiveHint,
  onPayRefresh,
  onClose,
  onPlaceOrder,
}: {
  title: string;
  subtitle: string;
  sku: string;
  orderableCount: number;
  detectedCount: number;
  shelf: string;
  showFakeFlag: boolean;
  trustChecks: TrustCheck[];
  attestation: AttestationDetails;
  attestedItems: StockItem[];
  liveCount: LiveCountResult | null;
  counting: boolean;
  countError: string | null;
  countLiveLabel: string;
  countLiveBusy: string;
  countLiveHint: string;
  onPayRefresh: () => void;
  onClose: () => void;
  onPlaceOrder: () => void;
}) {
  const [fullReport, setFullReport] = useState(false);
  const verified = !showFakeFlag;
  const liveMatch =
    liveCount?.steps?.challenge?.match || liveCount?.steps?.cmosMatch?.match;

  return (
    <Overlay onClose={counting ? () => undefined : onClose} wide>
      <div className="attest-modal">
        <div className="attest-modal-head">
          <div>
            <div className="overlay-title">{title || "Attestation"}</div>
            <div className="overlay-sub">{subtitle}</div>
          </div>
          <span className={`meta-chip ${verified ? "" : "meta-chip--fraud"}`}>
            {verified ? "Verified camera" : "Unverified"}
          </span>
        </div>

        {showFakeFlag && <FraudFlag />}
        {countError && <div className="field-error">{countError}</div>}

        <div className="attest-summary-grid">
          <div className="attest-summary-cell">
            <div className="detail-label">Orderable</div>
            <div className="attest-summary-value mono">{orderableCount}</div>
          </div>
          <div className="attest-summary-cell">
            <div className="detail-label">Detected</div>
            <div className="attest-summary-value mono">
              {liveCount ? liveCount.totalUnits : detectedCount}
            </div>
          </div>
          <div className="attest-summary-cell">
            <div className="detail-label">CMOS score</div>
            <div className="attest-summary-value mono">
              {liveCount?.cmosScore != null
                ? Number(liveCount.cmosScore).toFixed(2)
                : attestation.cmos_score != null
                  ? Number(attestation.cmos_score).toFixed(2)
                  : "—"}
            </div>
          </div>
          <div className="attest-summary-cell">
            <div className="detail-label">Captured</div>
            <div className="attest-summary-value attest-summary-value--sm">
              {new Date(
                liveCount?.countedAt ?? attestation.captured_at,
              ).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>

        <div className="attest-summary-meta">
          <span>
            <strong>SKU</strong> <span className="mono">{sku}</span>
          </span>
          {attestation.camera_label && (
            <span>
              <strong>Camera</strong> {attestation.camera_label}
            </span>
          )}
          {attestation.hcs_sequence_number != null && (
            <span>
              <strong>HCS</strong>{" "}
              <span className="mono">#{attestation.hcs_sequence_number}</span>
            </span>
          )}
          {liveCount && (
            <span>
              <strong>Live proof</strong> {liveMatch ? "match" : "checked"}
            </span>
          )}
        </div>

        {trustChecks.length > 0 && (
          <ul className="attest-trust-chips" aria-label="Trust checks">
            {trustChecks.map((check) => (
              <li key={check.title} data-ok={check.ok ? "true" : "false"}>
                {check.ok ? "✓" : "·"} {check.title}
              </li>
            ))}
          </ul>
        )}

        <div className="attest-modal-actions">
          <button
            className="btn btn-primary"
            onClick={onPayRefresh}
            disabled={counting}
          >
            {counting ? countLiveBusy : countLiveLabel}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setFullReport((v) => !v)}
            disabled={counting}
          >
            {fullReport ? "Hide full report" : "See full report"}
          </button>
        </div>
        <p className="row-sub attest-modal-hint">{countLiveHint}</p>

        {fullReport && (
          <div className="attest-full-report">
            {liveCount && (
              <section className="attest-report-section">
                <h3>Paid live proof</h3>
                <DetailRow
                  label="Detected in frame"
                  value={String(liveCount.totalUnits)}
                />
                <DetailRow
                  label="Detections"
                  value={String(liveCount.detectionCount)}
                />
                {liveCount.cmosScore != null && (
                  <DetailRow
                    label="CMOS / PUF score"
                    value={Number(liveCount.cmosScore).toFixed(3)}
                  />
                )}
                {liveCount.steps?.challenge && (
                  <>
                    <DetailRow
                      label="PUF / CMOS match"
                      value={liveMatch ? "yes" : "no"}
                    />
                    <DetailRow
                      label="OSD nonce match"
                      value={liveCount.steps.challenge.osdMatch ? "yes" : "no"}
                    />
                  </>
                )}
                {liveCount.nonce && (
                  <DetailRow label="Nonce" value={liveCount.nonce} mono />
                )}
                {liveCount.attestationId && (
                  <DetailRow
                    label="Attestation id"
                    value={liveCount.attestationId}
                    mono
                  />
                )}
                <DetailRow label="Engine" value={liveCount.engine} mono />
                <DetailRow label="Model" value={liveCount.model} mono />
                {liveCount.items.length > 0 && (
                  <table className="data-table" style={{ marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Detected</th>
                        <th>Shelf</th>
                        <th>Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveCount.items.map((i) => (
                        <tr key={`${i.sku}-${i.shelf}`}>
                          <td className="mono">{i.sku}</td>
                          <td className="mono">{i.count}</td>
                          <td>{i.shelf}</td>
                          <td className="mono">
                            {Math.round(i.confidence * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            <section className="attest-report-section">
              <h3>Stored attestation</h3>
              <DetailRow label="SKU" value={sku} mono />
              <DetailRow label="Shelf" value={shelf || "—"} />
              <DetailRow
                label="Captured at"
                value={new Date(attestation.captured_at).toLocaleString()}
              />
              <DetailRow label="Attestation id" value={attestation.id} mono />
              {attestation.hcs_topic_id && (
                <DetailRow
                  label="HCS topic"
                  value={attestation.hcs_topic_id}
                  mono
                />
              )}
              {attestation.hcs_sequence_number != null && (
                <DetailRow
                  label="HCS sequence"
                  value={String(attestation.hcs_sequence_number)}
                />
              )}
              <DetailRow
                label="Camera account"
                value={attestation.camera_account}
                mono
              />
              <DetailRow
                label="Nonce"
                value={shortHash(attestation.nonce, 14)}
                mono
              />
              <DetailRow
                label="Image hash"
                value={shortHash(attestation.image_hash, 14)}
                mono
              />
              {attestation.model && (
                <DetailRow label="Model" value={attestation.model} mono />
              )}
              <DetailRow
                label="Model hash"
                value={shortHash(attestation.model_hash, 14)}
                mono
              />
            </section>

            {trustChecks.length > 0 && (
              <section className="attest-report-section">
                <h3>Trust checks</h3>
                <ul className="attest-trust-list">
                  {trustChecks.map((check) => (
                    <li key={check.title} data-ok={check.ok ? "true" : "false"}>
                      <strong>{check.title}</strong>
                      <span>{check.body}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {attestedItems.length > 0 && (
              <section className="attest-report-section">
                <h3>SKUs in this capture</h3>
                <div className="attest-items">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Count</th>
                        <th>Shelf</th>
                        <th>Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attestedItems.map((i) => (
                        <tr
                          key={i.sku}
                          data-active={i.sku === sku ? "true" : undefined}
                        >
                          <td className="mono">{i.sku}</td>
                          <td className="mono">{i.count}</td>
                          <td>{i.shelf}</td>
                          <td className="mono">
                            {Math.round(i.confidence * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        <div className="confirm-actions" style={{ marginTop: 18 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onClose}
            disabled={counting}
          >
            Close
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={orderableCount < 1 || counting}
            onClick={onPlaceOrder}
          >
            Place order
          </button>
        </div>
      </div>
    </Overlay>
  );
}
