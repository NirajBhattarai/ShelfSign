"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch } from "@/lib/api";
import { Badge, ConfirmDialog, DetailRow } from "@/components/ui";
import { useToast } from "@/components/toast";
import {
  useSupplierData,
  type Order,
  type OrderStatus,
} from "../../SupplierDataContext";

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "New" },
  { status: "confirmed", label: "Processing" },
  { status: "fulfilled", label: "Received" },
];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const { orders, setOrders } = useSupplierData();

  const [order, setOrder] = useState<Order | null>(
    orders.find((o) => o.id === id) ?? null,
  );
  const [loading, setLoading] = useState(!order);
  const [confirmAction, setConfirmAction] = useState<
    "receive" | "cancel" | null
  >(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    apiGet<Order>(`/orders/${id}`)
      .then(setOrder)
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function updateStatus(status: OrderStatus) {
    if (!order) return;
    setUpdating(true);
    try {
      const updated = await apiPatch<Order>(`/orders/${order.id}/status`, {
        status,
      });
      setOrder(updated);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setConfirmAction(null);
      showToast(
        status === "fulfilled"
          ? "Order marked as received."
          : status === "cancelled"
            ? "Order cancelled."
            : "Order confirmed.",
        "success",
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Couldn't update that order.",
        "error",
      );
    } finally {
      setUpdating(false);
    }
  }

  if (loading) return null;

  if (!order) {
    return (
      <div>
        <button
          className="link-btn"
          onClick={() => router.push("/supplier/orders")}
        >
          ← Back to orders
        </button>
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="empty-state">
            <div className="empty-state-title">Order not found</div>
            <div className="empty-state-desc">
              This order doesn't exist, or it isn't one of yours.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentStepIndex = STEPS.findIndex((s) => s.status === order.status);
  const isCancelled = order.status === "cancelled";

  return (
    <div>
      <button
        className="link-btn"
        onClick={() => router.push("/supplier/orders")}
      >
        ← Back to orders
      </button>

      <div
        className="warehouse-header"
        style={{ marginTop: 16, marginBottom: 24 }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 5 }}>
            {order.sku}
          </h1>
          <div className="row-sub">
            Ordered by {order.buyer_company_name ?? "an unknown buyer"}
          </div>
        </div>
        <Badge status={order.status} />
      </div>

      {!isCancelled ? (
        <div className="panel panel-pad" style={{ marginBottom: 20 }}>
          <div className="order-progress">
            {STEPS.map((step, i) => (
              <div
                key={step.status}
                className="order-progress-step"
                data-done={i < currentStepIndex}
                data-current={i === currentStepIndex}
              >
                <div className="order-progress-line" />
                <div className="order-progress-dot" />
                <div className="order-progress-label">{step.label}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="panel panel-pad" style={{ marginBottom: 20 }}>
          <span className="order-progress-cancelled">
            This order was cancelled.
          </span>
        </div>
      )}

      <div className="panel panel-pad" style={{ marginBottom: 20 }}>
        <DetailRow label="Order ID" value={order.id} mono />
        <DetailRow
          label="Placed"
          value={new Date(order.created_at).toLocaleString()}
        />
        <DetailRow
          label="Buyer"
          value={order.buyer_company_name ?? "Unknown"}
        />
        <DetailRow
          label="Warehouse"
          value={order.warehouse_name ?? "Not linked to a specific warehouse"}
        />
        <DetailRow label="SKU" value={order.sku} mono />
        <DetailRow label="Quantity" value={String(order.quantity)} />
      </div>

      {order.status === "pending" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn btn-primary"
            onClick={() => updateStatus("confirmed")}
            disabled={updating}
          >
            {updating ? "Working…" : "Confirm order"}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setConfirmAction("cancel")}
            disabled={updating}
          >
            Cancel order
          </button>
        </div>
      )}

      {order.status === "confirmed" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn btn-primary"
            onClick={() => setConfirmAction("receive")}
            disabled={updating}
          >
            Mark as received
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setConfirmAction("cancel")}
            disabled={updating}
          >
            Cancel order
          </button>
        </div>
      )}

      {confirmAction === "receive" && (
        <ConfirmDialog
          title="Mark this order as received?"
          description={`This confirms ${order.sku} × ${order.quantity} for ${order.buyer_company_name ?? "this buyer"} has been fulfilled. This can't be undone.`}
          confirmLabel="Mark as received"
          busy={updating}
          onConfirm={() => updateStatus("fulfilled")}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction === "cancel" && (
        <ConfirmDialog
          title="Cancel this order?"
          description={`${order.sku} × ${order.quantity} for ${order.buyer_company_name ?? "this buyer"} will be cancelled. This can't be undone.`}
          confirmLabel="Cancel order"
          destructive
          busy={updating}
          onConfirm={() => updateStatus("cancelled")}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
