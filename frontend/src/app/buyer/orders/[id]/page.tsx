"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { Badge, DetailRow, EmptyState } from "@/components/ui";
import {
  useBuyerData,
  type BuyerOrder,
  type OrderStatus,
} from "../../BuyerDataContext";

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "Placed" },
  { status: "confirmed", label: "Confirmed" },
  { status: "fulfilled", label: "Fulfilled" },
];

export default function BuyerOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { orders } = useBuyerData();

  const [order, setOrder] = useState<BuyerOrder | null>(
    orders.find((o) => o.id === id) ?? null,
  );
  const [loading, setLoading] = useState(!order);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<BuyerOrder>(`/orders/${id}`)
      .then((data) => {
        if (!cancelled) {
          setOrder(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setOrder(null);
          setError(
            err instanceof Error ? err.message : "Couldn't load this order.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div>
        <div
          className="skeleton skeleton-line"
          style={{ width: 140, marginBottom: 20 }}
        />
        <div
          className="skeleton skeleton-block"
          style={{ height: 90, marginBottom: 16 }}
        />
        <div className="skeleton skeleton-block" style={{ height: 220 }} />
      </div>
    );
  }

  if (!order) {
    return (
      <div>
        <button
          className="link-btn"
          onClick={() => router.push("/buyer/orders")}
        >
          ← Back to orders
        </button>
        <div className="panel panel-pad" style={{ marginTop: 16 }}>
          <EmptyState
            title="Order not found"
            description={
              error ?? "This order doesn't exist, or it isn't one of yours."
            }
            action={
              <button
                className="btn btn-primary"
                onClick={() => router.push("/buyer/orders")}
              >
                View orders
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const currentStepIndex = STEPS.findIndex((s) => s.status === order.status);
  const isCancelled = order.status === "cancelled";

  return (
    <div>
      <button className="link-btn" onClick={() => router.push("/buyer/orders")}>
        ← Back to orders
      </button>

      <div
        className="warehouse-header"
        style={{ marginTop: 16, marginBottom: 24 }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 5 }}>
            Order · {order.sku}
          </h1>
          <div className="row-sub">
            Placed {new Date(order.created_at).toLocaleString()}
            {order.supplier_company_name
              ? ` · ${order.supplier_company_name}`
              : ""}
          </div>
        </div>
        <Badge status={order.status} />
      </div>

      {!isCancelled ? (
        <div className="panel panel-pad" style={{ marginBottom: 20 }}>
          <div className="order-progress" aria-label="Order status progress">
            {STEPS.map((step, i) => (
              <div
                key={step.status}
                className="order-progress-step"
                data-done={currentStepIndex >= 0 && i < currentStepIndex}
                data-current={i === currentStepIndex}
              >
                <div className="order-progress-line" />
                <div className="order-progress-dot" />
                <div className="order-progress-label">{step.label}</div>
              </div>
            ))}
          </div>
          <p className="row-sub" style={{ marginTop: 16, marginBottom: 0 }}>
            Status updates when your supplier confirms and fulfills the order.
            No carrier tracking is available yet.
          </p>
        </div>
      ) : (
        <div className="panel panel-pad" style={{ marginBottom: 20 }}>
          <span className="order-progress-cancelled">
            This order was cancelled.
          </span>
        </div>
      )}

      <div className="panel panel-pad" style={{ marginBottom: 20 }}>
        <div className="overlay-title" style={{ marginBottom: 14 }}>
          Order summary
        </div>
        <DetailRow label="Order ID" value={order.id} mono />
        <DetailRow
          label="Placed"
          value={new Date(order.created_at).toLocaleString()}
        />
        <DetailRow
          label="Supplier"
          value={order.supplier_company_name ?? "Unknown"}
        />
        <DetailRow
          label="Warehouse"
          value={order.warehouse_name ?? "Not linked to a specific warehouse"}
        />
        <DetailRow label="SKU" value={order.sku} mono />
        <DetailRow label="Quantity" value={String(order.quantity)} />
        {order.attestation_id && (
          <DetailRow label="Attestation" value={order.attestation_id} mono />
        )}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          onClick={() => router.push("/buyer/stock")}
        >
          Browse more stock
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => router.push("/buyer/orders")}
        >
          All orders
        </button>
      </div>
    </div>
  );
}
