"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiGetPaid, apiPost, type X402Challenge } from "@/lib/api";
import { signExactPaymentHeaderWithSigner } from "@/lib/x402Client";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { PayUnlockDialog } from "@/components/PayUnlockDialog";
import {
  Badge,
  DetailRow,
  EmptyState,
  Overlay,
  PageHeader,
} from "@/components/ui";
import { type StockItem, type StockRow } from "../../../BuyerDataContext";
import { PlaceOrderDialog } from "../../../PlaceOrderDialog";

interface TrustCheck {
  title: string;
  body: string;
  ok: boolean;
}

interface LiveCountResult {
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
  fullAttestation?: boolean;
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

interface StockDetailResponse {
  warehouse: StockRow["warehouse"];
  item: StockRow["item"] & { detectedCount?: number };
  skuAbsent?: boolean;
  attestation: StockRow["attestation"] & {
    camera_label?: string | null;
    model?: string | null;
    items: StockRow["item"][];
    cmos_score?: number | null;
    detection_count?: number | null;
  };
  liveStreamUrl: string | null;
  totalUnits?: number;
  detectedTotal?: number;
  trustChecks: TrustCheck[];
  copy: {
    attestationBlurb: string;
    livePill: string;
    liveUnavailable: string;
    liveConnecting: string;
    liveFallback: string;
    overlayTitle: string;
    overlaySub: string;
    countLiveLabel?: string;
    countLiveBusy?: string;
    countLiveHint?: string;
  };
}

export default function StockDetailPage() {
  const params = useParams<{ warehouseId: string; sku: string }>();
  const warehouseId = params.warehouseId;
  const sku = decodeURIComponent(params.sku);
  const router = useRouter();

  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [showAttest, setShowAttest] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);
  const [counting, setCounting] = useState(false);
  const [liveCount, setLiveCount] = useState<LiveCountResult | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payChallenge, setPayChallenge] = useState<X402Challenge | null>(null);
  const [paidQuery, setPaidQuery] = useState<{
    paid: boolean;
    x402: {
      mock?: boolean;
      amount?: string;
      asset?: string;
      network?: string;
      payer?: string | null;
      settlementTx?: string | null;
      hcs?: {
        topicId?: string;
        sequenceNumber?: number | null;
        transactionId?: string | null;
        hashscanUrl?: string | null;
      } | null;
    };
    item: { sku: string; count: number; detectedCount?: number };
  } | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const { getClientSigner } = useHederaWallet();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLiveFailed(false);
    setError(null);

    apiGet<StockDetailResponse>(
      `/warehouses/${warehouseId}/stock/${encodeURIComponent(sku)}`,
    )
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail(null);
        setError(
          err instanceof Error ? err.message : "Couldn't load this stock item.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [warehouseId, sku]);

  async function openPayDialog() {
    setPayError(null);
    setPaying(true);
    try {
      const challenge = await apiGet<X402Challenge>(
        `/stock/${warehouseId}/${encodeURIComponent(sku)}/challenge`,
      );
      setPayChallenge(challenge);
      setPayOpen(true);
    } catch (err) {
      setPayError(
        err instanceof Error ? err.message : "Couldn't load payment challenge.",
      );
    } finally {
      setPaying(false);
    }
  }

  async function confirmPayUnlock() {
    if (!payChallenge) return;
    setPaying(true);
    setPayError(null);
    try {
      const path = `/stock/${warehouseId}/${encodeURIComponent(sku)}`;
      let paymentSignature: string | undefined;

      if (
        payChallenge.mock ||
        process.env.NEXT_PUBLIC_X402_MOCK === "1"
      ) {
        paymentSignature = "mock";
      } else {
        const requirements = payChallenge.accepts?.[0];
        if (!requirements) {
          throw new Error("Challenge missing payment requirements.");
        }
        const signer = await getClientSigner();
        const signed = await signExactPaymentHeaderWithSigner(
          requirements,
          signer,
        );
        paymentSignature = signed.paymentHeader;
      }

      const result = await apiGetPaid<{
        paid: boolean;
        x402: NonNullable<typeof paidQuery>["x402"];
        item: { sku: string; count: number; detectedCount?: number };
      }>(path, { paymentSignature });

      setPaidQuery(result);
      setPayOpen(false);
      setPayChallenge(null);
    } catch (err) {
      setPaidQuery(null);
      const msg =
        err instanceof Error ? err.message : "x402 payment failed.";
      if (msg !== "Payment cancelled") setPayError(msg);
    } finally {
      setPaying(false);
    }
  }

  async function countLiveFrame() {
    if (!detail) return;
    setCounting(true);
    setCountError(null);
    try {
      const result = await apiPost<LiveCountResult>(
        `/warehouses/${warehouseId}/count-live`,
        {
          cameraId: detail.attestation.camera_id ?? undefined,
        },
      );
      setLiveCount(result);
      // Refresh page data so published attestation totals update.
      // If this SKU wasn't in the frame, API still returns count 0 (not 404).
      try {
        const refreshed = await apiGet<StockDetailResponse>(
          `/warehouses/${warehouseId}/stock/${encodeURIComponent(sku)}`,
        );
        setDetail(refreshed);
      } catch {
        const fromLive = (result.items ?? []).find((i) => i.sku === sku);
        setDetail({
          ...detail,
          skuAbsent: !fromLive,
          item: {
            ...detail.item,
            confidence: fromLive?.confidence ?? detail.item.confidence,
            detectedCount: fromLive?.count ?? 0,
          },
          detectedTotal: result.totalUnits,
          attestation: {
            ...detail.attestation,
            id: result.attestationId ?? detail.attestation.id,
            camera_id: result.cameraId,
            items: result.items ?? [],
            image_hash: result.imageHash,
            model: result.model,
            nonce: result.nonce ?? detail.attestation.nonce,
            captured_at: result.countedAt,
            cmos_score: result.cmosScore ?? detail.attestation.cmos_score,
            detection_count: result.detectionCount,
          },
        });
      }
    } catch (err) {
      setLiveCount(null);
      setCountError(
        err instanceof Error ? err.message : "Live attestation failed.",
      );
    } finally {
      setCounting(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div
          className="skeleton skeleton-line"
          style={{ width: 120, marginBottom: 24 }}
        />
        <div className="product-detail">
          <div className="skeleton skeleton-block" style={{ minHeight: 320 }} />
          <div>
            <div
              className="skeleton skeleton-line"
              style={{ width: "70%", height: 28, marginBottom: 16 }}
            />
            <div className="skeleton skeleton-block" style={{ height: 180 }} />
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <button
          className="link-btn"
          onClick={() => router.push("/buyer/stock")}
        >
          ← Back to catalog
        </button>
        <div className="panel panel-pad" style={{ marginTop: 16 }}>
          <EmptyState
            title="Stock item not found"
            description={
              error ??
              "This SKU may no longer be in the latest attestation for that warehouse."
            }
            action={
              <button
                className="btn btn-primary"
                onClick={() => router.push("/buyer/stock")}
              >
                Browse stock
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const { warehouse, attestation, item, copy, trustChecks, liveStreamUrl } =
    detail;
  const attestedItems = attestation.items ?? [];
  const attestedTotal =
    detail.totalUnits ??
    attestedItems.reduce((n, i) => n + (Number(i.count) || 0), 0);
  const orderTarget: StockRow = { warehouse, attestation, item };

  function openAttestation() {
    setLiveCount(null);
    setCountError(null);
    setShowAttest(true);
  }

  return (
    <div>
      <button className="link-btn" onClick={() => router.push("/buyer/stock")}>
        ← Back to catalog
      </button>

      <div className="product-detail" style={{ marginTop: 18 }}>
        <div className="product-detail-media product-detail-live">
          {liveStreamUrl && !liveFailed ? (
            <>
              <img
                src={liveStreamUrl}
                alt={`Live camera at ${warehouse.name}`}
                className="camera-live-view"
                onError={() => setLiveFailed(true)}
              />
              <div className="live-pill" aria-live="polite">
                <span className="live-pill-dot" />
                {copy.livePill}
              </div>
            </>
          ) : warehouse.image_url ? (
            <>
              <img
                src={warehouse.image_url}
                alt={`${warehouse.name} warehouse`}
                fetchPriority="high"
              />
              <div className="live-pill live-pill-muted">
                {liveFailed || !liveStreamUrl
                  ? copy.liveFallback
                  : copy.liveConnecting}
              </div>
            </>
          ) : (
            <div className="product-detail-media-empty">
              {liveFailed || !liveStreamUrl
                ? copy.liveUnavailable
                : copy.liveConnecting}
            </div>
          )}
        </div>

        <div className="product-detail-info">
          <PageHeader
            title={item.sku}
            description={`${warehouse.profiles?.company_name ?? "Supplier"} · ${warehouse.name}`}
          />

          <div className="product-detail-badges">
            <Badge status="verified" />
            <span className="meta-chip">
              {item.count > 0 ? "Available" : "Out of stock"}
            </span>
            <span className="meta-chip">
              Attested {new Date(attestation.captured_at).toLocaleString()}
            </span>
            {detail.skuAbsent ? (
              <span className="meta-chip">Not seen in latest frame</span>
            ) : null}
            {attestation.cmos_score != null ? (
              <span className="meta-chip">
                CMOS score {Number(attestation.cmos_score).toFixed(3)}
              </span>
            ) : null}
          </div>

          <div className="product-detail-figures">
            <div>
              <div className="detail-label">Available to order</div>
              <div className="product-figure mono">{item.count}</div>
            </div>
            <div>
              <div className="detail-label">Detected in frame</div>
              <div className="product-figure mono">
                {item.detectedCount ?? 0}
              </div>
            </div>
            <div>
              <div className="detail-label">Shelf</div>
              <div className="product-figure mono">{item.shelf || "—"}</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 28,
            }}
          >
            <button className="btn btn-primary" onClick={openAttestation}>
              View attestation
            </button>
            <button
              className="btn btn-ghost"
              disabled={item.count < 1}
              onClick={() => setOrdering(true)}
            >
              Place order
            </button>
            <button
              className="btn btn-ghost"
              onClick={openPayDialog}
              disabled={paying}
            >
              {paying && !payOpen ? "Loading price…" : "Pay & unlock (x402)"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => router.push("/buyer/orders")}
            >
              View my orders
            </button>
          </div>

          {payError && (
            <div className="field-error" style={{ marginBottom: 16 }}>
              {payError}
            </div>
          )}

          {paidQuery && (
            <div className="panel panel-pad" style={{ marginBottom: 16 }}>
              <div className="overlay-title" style={{ marginBottom: 10 }}>
                x402 paid stock query
              </div>
              <DetailRow
                label="Mode"
                value={paidQuery.x402.mock ? "mock (local)" : "Hedera settle"}
              />
              <DetailRow
                label="Network"
                value={paidQuery.x402.network ?? "—"}
                mono
              />
              <DetailRow
                label="Amount"
                value={`${paidQuery.x402.amount ?? "—"} (${paidQuery.x402.asset ?? "—"})`}
                mono
              />
              <DetailRow label="Payer" value={paidQuery.x402.payer} mono />
              <DetailRow
                label="Settlement tx"
                value={paidQuery.x402.settlementTx}
                mono
              />
              {paidQuery.x402.hcs && (
                <>
                  <DetailRow
                    label="HCS topic"
                    value={paidQuery.x402.hcs.topicId}
                    mono
                  />
                  <DetailRow
                    label="HCS sequence"
                    value={
                      paidQuery.x402.hcs.sequenceNumber != null
                        ? String(paidQuery.x402.hcs.sequenceNumber)
                        : "—"
                    }
                    mono
                  />
                  {paidQuery.x402.hcs.hashscanUrl && (
                    <DetailRow
                      label="HashScan"
                      value={paidQuery.x402.hcs.hashscanUrl}
                    />
                  )}
                </>
              )}
              <DetailRow
                label="Orderable qty"
                value={String(paidQuery.item.count)}
              />
              <DetailRow
                label="Detected in frame"
                value={String(paidQuery.item.detectedCount ?? 0)}
              />
            </div>
          )}

          <div className="panel panel-pad" style={{ marginBottom: 16 }}>
            <div className="overlay-title" style={{ marginBottom: 14 }}>
              Supplier & location
            </div>
            <DetailRow
              label="Supplier"
              value={warehouse.profiles?.company_name ?? "Unknown"}
            />
            <DetailRow label="Warehouse" value={warehouse.name} />
            <DetailRow
              label="Location"
              value={warehouse.location ?? "Not specified"}
            />
            <DetailRow
              label="Categories"
              value={
                warehouse.categories.length
                  ? warehouse.categories.join(", ")
                  : "None"
              }
            />
          </div>

          <div className="panel panel-pad">
            <div
              className="overlay-title"
              style={{
                marginBottom: 8,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <span>Attestation</span>
              <button
                className="link-btn"
                style={{ marginTop: 0 }}
                onClick={openAttestation}
              >
                Full proof →
              </button>
            </div>
            <p className="row-sub" style={{ marginBottom: 14 }}>
              {copy.attestationBlurb}
            </p>
            <DetailRow
              label="Captured"
              value={new Date(attestation.captured_at).toLocaleString()}
            />
            <DetailRow
              label="Camera account"
              value={attestation.camera_account}
              mono
            />
            <DetailRow label="Nonce" value={attestation.nonce} mono />
          </div>
        </div>
      </div>

      {showAttest && (
        <Overlay onClose={() => setShowAttest(false)} wide>
          <div className="overlay-title">{copy.overlayTitle}</div>
          <div className="overlay-sub">{copy.overlaySub}</div>

          <div className="attest-total-banner">
            <div>
              <div className="detail-label">Available to order</div>
              <div className="product-figure mono">{item.count}</div>
            </div>
            <button
              className="btn btn-primary"
              onClick={countLiveFrame}
              disabled={counting}
            >
              {counting
                ? (copy.countLiveBusy ?? "Counting…")
                : (copy.countLiveLabel ?? "Refresh camera proof")}
            </button>
          </div>
          <p className="row-sub" style={{ marginBottom: 16 }}>
            {copy.countLiveHint ??
              "Camera proof only — does not change orderable stock."}
          </p>

          {countError && <div className="field-error">{countError}</div>}

          {liveCount && (
            <div className="panel panel-pad" style={{ marginBottom: 16 }}>
              <div className="overlay-title" style={{ marginBottom: 10 }}>
                Camera attestation (evidence)
              </div>
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
                    value={
                      liveCount.steps.challenge.match ||
                      liveCount.steps.cmosMatch?.match
                        ? "yes"
                        : "no"
                    }
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
              <DetailRow
                label="Attested at"
                value={new Date(liveCount.countedAt).toLocaleString()}
              />
              {liveCount.items.length > 0 && (
                <table className="data-table" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Detected</th>
                      <th>Shelf</th>
                      <th>Confidence</th>
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
            </div>
          )}

          {trustChecks.length > 0 && (
            <ul className="attest-trust-list">
              {trustChecks.map((check) => (
                <li key={check.title} data-ok={check.ok ? "true" : "false"}>
                  <strong>{check.title}</strong>
                  <span>{check.body}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="panel panel-pad" style={{ marginBottom: 16 }}>
            <DetailRow label="SKU" value={item.sku} mono />
            <DetailRow
              label="Available to order"
              value={String(item.count)}
            />
            <DetailRow
              label="Detected in frame"
              value={String(item.detectedCount ?? 0)}
            />
            {attestation.cmos_score != null && (
              <DetailRow
                label="CMOS / PUF score"
                value={Number(attestation.cmos_score).toFixed(3)}
              />
            )}
            <DetailRow label="Shelf" value={item.shelf || "—"} />
            <DetailRow
              label="Captured at"
              value={new Date(attestation.captured_at).toLocaleString()}
            />
            <DetailRow label="Attestation id" value={attestation.id} mono />
            {"hcs_topic_id" in attestation &&
              (attestation as { hcs_topic_id?: string | null }).hcs_topic_id && (
                <DetailRow
                  label="HCS topic"
                  value={
                    (attestation as { hcs_topic_id?: string }).hcs_topic_id
                  }
                  mono
                />
              )}
            {"hcs_sequence_number" in attestation &&
              (attestation as { hcs_sequence_number?: number | null })
                .hcs_sequence_number != null && (
                <DetailRow
                  label="HCS sequence"
                  value={String(
                    (attestation as { hcs_sequence_number?: number })
                      .hcs_sequence_number,
                  )}
                  mono
                />
              )}
            <DetailRow
              label="Camera account"
              value={attestation.camera_account}
              mono
            />
            {attestation.camera_label && (
              <DetailRow label="Camera" value={attestation.camera_label} />
            )}
            <DetailRow label="Nonce" value={attestation.nonce} mono />
            <DetailRow label="Image hash" value={attestation.image_hash} mono />
            {attestation.model && (
              <DetailRow label="Model" value={attestation.model} mono />
            )}
            <DetailRow label="Model hash" value={attestation.model_hash} mono />
          </div>

          {attestedItems.length > 0 && (
            <div className="attest-items">
              <div
                className="overlay-title"
                style={{ fontSize: 14, marginBottom: 10 }}
              >
                All SKUs in this capture
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Count</th>
                    <th>Shelf</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {attestedItems.map((i) => (
                    <tr
                      key={i.sku}
                      data-active={i.sku === item.sku ? "true" : undefined}
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
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button
              className="btn btn-ghost"
              style={{ flex: 1 }}
              onClick={() => setShowAttest(false)}
            >
              Close
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={item.count < 1}
              onClick={() => {
                setShowAttest(false);
                setOrdering(true);
              }}
            >
              Place order
            </button>
          </div>
        </Overlay>
      )}

      {ordering && (
        <PlaceOrderDialog
          target={orderTarget}
          onClose={() => setOrdering(false)}
        />
      )}

      {payOpen && payChallenge && detail && (
        <PayUnlockDialog
          sku={sku}
          warehouseName={
            detail.warehouse.profiles?.company_name
              ? `${detail.warehouse.profiles.company_name} · ${detail.warehouse.name}`
              : detail.warehouse.name
          }
          challenge={payChallenge}
          busy={paying}
          error={payError}
          onConfirm={confirmPayUnlock}
          onCancel={() => {
            if (paying) return;
            setPayOpen(false);
            setPayChallenge(null);
            setPayError(null);
          }}
        />
      )}
    </div>
  );
}
