"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { Overlay } from "@/components/ui";
import { useToast } from "@/components/toast";
import {
  useBuyerData,
  type BuyerOrder,
  type StockRow,
} from "./BuyerDataContext";

export function PlaceOrderDialog({
  target,
  onClose,
}: {
  target: StockRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const { setOrders } = useBuyerData();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const max = Math.max(1, target.item.count);

  async function placeOrder() {
    if (busy) return;
    setBusy(true);
    try {
      const order = await apiPost<BuyerOrder>("/orders", {
        supplierId: target.warehouse.supplier_id,
        sku: target.item.sku,
        quantity: qty,
        attestationId: target.attestation.id,
      });
      setOrders((prev) => [order, ...prev]);
      showToast(`Order placed for ${target.item.sku} × ${qty}.`, "success");
      onClose();
      router.push(`/buyer/orders/${order.id}`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Couldn't place that order.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={busy ? () => undefined : onClose}>
      <div className="overlay-title">Place buy order</div>
      <div className="overlay-sub">
        {target.item.sku} from{" "}
        {target.warehouse.profiles?.company_name ?? "supplier"} ·{" "}
        {target.warehouse.name}
      </div>

      <div className="order-summary-strip">
        <div>
          <div className="detail-label">Available</div>
          <div className="mono">{target.item.count} units</div>
        </div>
        <div>
          <div className="detail-label">Shelf</div>
          <div className="mono">{target.item.shelf}</div>
        </div>
        <div>
          <div className="detail-label">Confidence</div>
          <div className="mono">
            {Math.round(target.item.confidence * 100)}%
          </div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="order-qty">Quantity</label>
        <input
          id="order-qty"
          type="number"
          min={1}
          max={max}
          value={qty}
          disabled={busy}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10) || 1;
            setQty(Math.min(max, Math.max(1, next)));
          }}
        />
      </div>

      <div className="confirm-actions">
        <button
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={placeOrder}
          disabled={busy}
        >
          {busy ? "Placing…" : "Place order"}
        </button>
      </div>
    </Overlay>
  );
}
