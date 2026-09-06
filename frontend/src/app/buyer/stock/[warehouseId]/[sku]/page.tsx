"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
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
  item: StockRow["item"];
  skuAbsent?: boolean;
  attestation: StockRow["attestation"] & {
    camera_label?: string | null;
    model?: string | null;
    items: StockRow["item"][];
  };
  liveStreamUrl: string | null;
  totalUnits?: number;
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
          item: fromLive ?? {
            sku,
            count: 0,
            confidence: 0,
            shelf: "",
          },
          totalUnits: result.totalUnits,
          attestation: {
            ...detail.attestation,
            id: result.attestationId ?? detail.attestation.id,
            camera_id: result.cameraId,
            items: result.items ?? [],
            image_hash: result.imageHash,
            model: result.model,
            nonce: result.nonce ?? detail.attestation.nonce,
            captured_at: result.countedAt,
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
              {detail.skuAbsent || item.count <= 0
                ? "Out of stock"
                : "Available"}
            </span>
            <span className="meta-chip">
              Attested {new Date(attestation.captured_at).toLocaleString()}
            </span>
            {detail.skuAbsent ? (
              <span className="meta-chip">Not in latest camera frame</span>
            ) : null}
          </div>

          <div className="product-detail-figures">
            <div>
              <div className="detail-label">Available units</div>
              <div className="product-figure mono">{item.count}</div>
            </div>
            <div>
              <div className="detail-label">Shelf</div>
              <div className="product-figure mono">{item.shelf}</div>
            </div>
            <div>
              <div className="detail-label">Detection confidence</div>
              <div className="product-figure mono">
                {Math.round(item.confidence * 100)}%
              </div>
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
              onClick={() => router.push("/buyer/orders")}
            >
              View my orders
            </button>
          </div>

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
              <div className="detail-label">Total units in attestation</div>
              <div className="product-figure mono">{attestedTotal}</div>
            </div>
            <button
              className="btn btn-primary"
              onClick={countLiveFrame}
              disabled={counting}
            >
              {counting
                ? (copy.countLiveBusy ?? "Counting…")
                : (copy.countLiveLabel ?? "Count live frame")}
            </button>
          </div>
          <p className="row-sub" style={{ marginBottom: 16 }}>
            {copy.countLiveHint ??
              "Capture a fresh still from this warehouse camera and count objects with YOLO/PyTorch."}
          </p>

          {countError && <div className="field-error">{countError}</div>}

          {liveCount && (
            <div className="panel panel-pad" style={{ marginBottom: 16 }}>
              <div className="overlay-title" style={{ marginBottom: 10 }}>
                {liveCount.fullAttestation
                  ? "Live attestation result"
                  : "Live frame count"}
              </div>
              <DetailRow
                label="Total units on frame"
                value={String(liveCount.totalUnits)}
              />
              <DetailRow
                label="Detections"
                value={String(liveCount.detectionCount)}
              />
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
                      <th>Count</th>
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
              label="Units in attestation"
              value={String(item.count)}
            />
            <DetailRow label="Shelf" value={item.shelf} />
            <DetailRow
              label="Confidence"
              value={`${Math.round(item.confidence * 100)}%`}
            />
            <DetailRow
              label="Captured at"
              value={new Date(attestation.captured_at).toLocaleString()}
            />
            <DetailRow label="Attestation id" value={attestation.id} mono />
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
    </div>
  );
}
