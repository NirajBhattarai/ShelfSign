"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiGetPaid, apiPostPaid, type X402Challenge } from "@/lib/api";
import { signExactPaymentHeaderWithSigner } from "@/lib/x402Client";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { PayUnlockDialog } from "@/components/PayUnlockDialog";
import {
  ViewAttestationModal,
  type LiveCountResult,
} from "@/components/ViewAttestationModal";
import { FraudFlag } from "@/components/FraudFlag";
import { Badge, DetailRow, EmptyState, PageHeader } from "@/components/ui";
import { type StockRow } from "../../../BuyerDataContext";
import { PlaceOrderDialog } from "../../../PlaceOrderDialog";

interface TrustCheck {
  title: string;
  body: string;
  ok: boolean;
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
  camera?: {
    id: string;
    label: string | null;
    isFake: boolean;
    fraudDetectedAt: string | null;
  } | null;
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
  /** "unlock" = stock query; "attest" = live camera proof refresh */
  const [payPurpose, setPayPurpose] = useState<"unlock" | "attest">("unlock");
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
    setPayPurpose("unlock");
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

  async function openPayForLiveAttest() {
    if (!detail) return;
    setPayError(null);
    setCountError(null);
    setCounting(true);
    setPayPurpose("attest");
    try {
      // Unpaid probe → 402 challenge for live attest.
      await apiPostPaid<LiveCountResult>(
        `/warehouses/${warehouseId}/count-live`,
        { cameraId: detail.attestation.camera_id ?? undefined },
        {
          onChallenge: async (challenge) => {
            setPayChallenge(challenge);
            setPayOpen(true);
            setCounting(false);
            return false; // abort; confirmPay will retry with signature
          },
        },
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't start payment.";
      if (msg !== "Payment cancelled") setCountError(msg);
      setCounting(false);
    }
  }

  async function confirmPayUnlock() {
    if (!payChallenge) return;
    setPaying(true);
    setPayError(null);
    try {
      const requirements = payChallenge.accepts?.[0];
      if (!requirements) {
        throw new Error("Challenge missing payment requirements.");
      }
      if (!requirements.extra?.feePayer) {
        throw new Error(
          "Facilitator feePayer missing — check X402_FACILITATOR_URL / network.",
        );
      }

      const signer = await getClientSigner();
      const signed = await signExactPaymentHeaderWithSigner(
        requirements,
        signer,
      );

      if (payPurpose === "attest") {
        setCounting(true);
        const result = await apiPostPaid<LiveCountResult>(
          `/warehouses/${warehouseId}/count-live`,
          { cameraId: detail?.attestation.camera_id ?? undefined },
          { paymentSignature: signed.paymentHeader },
        );
        setLiveCount(result);
        setPayOpen(false);
        setPayChallenge(null);
        try {
          const refreshed = await apiGet<StockDetailResponse>(
            `/warehouses/${warehouseId}/stock/${encodeURIComponent(sku)}`,
          );
          setDetail(refreshed);
        } catch {
          /* keep prior detail */
        }
      } else {
        const path = `/stock/${warehouseId}/${encodeURIComponent(sku)}`;
        const result = await apiGetPaid<{
          paid: boolean;
          x402: NonNullable<typeof paidQuery>["x402"];
          item: { sku: string; count: number; detectedCount?: number };
        }>(path, { paymentSignature: signed.paymentHeader });

        setPaidQuery(result);
        setPayOpen(false);
        setPayChallenge(null);
      }
    } catch (err) {
      if (payPurpose === "attest") {
        setLiveCount(null);
        const raw =
          err instanceof Error ? err.message : "Live attestation failed.";
        const friendly =
          /cmos_mismatch|signature_invalid|verification_failed/i.test(raw)
            ? "Camera authenticity could not be confirmed. This warehouse has been marked unverified."
            : raw;
        if (raw !== "Payment cancelled") setCountError(friendly);
        try {
          const refreshed = await apiGet<StockDetailResponse>(
            `/warehouses/${warehouseId}/stock/${encodeURIComponent(sku)}`,
          );
          setDetail(refreshed);
        } catch {
          /* keep prior */
        }
      } else {
        setPaidQuery(null);
        const msg = err instanceof Error ? err.message : "x402 payment failed.";
        if (msg !== "Payment cancelled") setPayError(msg);
      }
    } finally {
      setPaying(false);
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

  const {
    warehouse,
    attestation,
    item,
    copy,
    trustChecks,
    liveStreamUrl,
    camera,
  } = detail;
  /** Fake UI only after DB says so (set when refresh/attest detects CMOS fraud). */
  const showFakeFlag = Boolean(camera?.isFake);
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
            {showFakeFlag ? (
              <span className="meta-chip meta-chip--fraud">
                Unverified camera
              </span>
            ) : (
              <Badge status="verified" />
            )}
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

          {showFakeFlag && <FraudFlag />}

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
              disabled={item.count < 1 || showFakeFlag}
              title={
                showFakeFlag
                  ? "Ordering unavailable while camera authenticity is unverified"
                  : undefined
              }
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
              <DetailRow label="Mode" value="Hedera x402 settle" />
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
        <ViewAttestationModal
          title={copy.overlayTitle}
          subtitle={copy.overlaySub}
          sku={item.sku}
          orderableCount={item.count}
          detectedCount={item.detectedCount ?? 0}
          shelf={item.shelf || "—"}
          showFakeFlag={showFakeFlag}
          trustChecks={trustChecks}
          attestation={{
            id: attestation.id,
            camera_id: attestation.camera_id,
            camera_account: attestation.camera_account,
            camera_label: attestation.camera_label,
            nonce: attestation.nonce,
            image_hash: attestation.image_hash,
            model: attestation.model ?? null,
            model_hash: attestation.model_hash,
            items: attestedItems,
            captured_at: attestation.captured_at,
            cmos_score: attestation.cmos_score,
            hcs_topic_id:
              (attestation as { hcs_topic_id?: string | null }).hcs_topic_id ??
              null,
            hcs_sequence_number:
              (attestation as { hcs_sequence_number?: number | null })
                .hcs_sequence_number ?? null,
          }}
          attestedItems={attestedItems}
          liveCount={liveCount}
          counting={counting || (paying && payPurpose === "attest")}
          countError={countError}
          countLiveLabel={copy.countLiveLabel ?? "Pay & refresh proof"}
          countLiveBusy={copy.countLiveBusy ?? "Paying & attesting…"}
          countLiveHint={
            copy.countLiveHint ??
            "Pay with x402 to re-run live CMOS + nonce proof."
          }
          onPayRefresh={openPayForLiveAttest}
          onClose={() => setShowAttest(false)}
          onPlaceOrder={() => {
            setShowAttest(false);
            setOrdering(true);
          }}
        />
      )}

      {ordering && (
        <PlaceOrderDialog
          target={orderTarget}
          onClose={() => setOrdering(false)}
        />
      )}

      {payOpen && payChallenge && detail && (
        <PayUnlockDialog
          title={
            payPurpose === "attest"
              ? "Pay & refresh camera proof"
              : "Unlock attested stock"
          }
          subtitle={
            payPurpose === "attest"
              ? `${sku} · Live CMOS + nonce attestation · Hedera x402`
              : undefined
          }
          confirmVerb={payPurpose === "attest" ? "Pay & attest" : "Pay"}
          sku={sku}
          warehouseName={
            detail.warehouse.profiles?.company_name
              ? `${detail.warehouse.profiles.company_name} · ${detail.warehouse.name}`
              : detail.warehouse.name
          }
          challenge={payChallenge}
          busy={paying || counting}
          error={payPurpose === "attest" ? countError : payError}
          onConfirm={confirmPayUnlock}
          onCancel={() => {
            if (paying || counting) return;
            setPayOpen(false);
            setPayChallenge(null);
            setPayError(null);
          }}
        />
      )}
    </div>
  );
}
