"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { useBuyerData, type OrderStatus } from "../BuyerDataContext";

type StatusFilter = "all" | OrderStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
];

function OrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orders, loading } = useBuyerData();

  const initialStatus = (searchParams.get("status") as StatusFilter) ?? "all";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    STATUS_TABS.some((t) => t.value === initialStatus) ? initialStatus : "all",
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [
          o.id,
          o.sku,
          o.supplier_company_name ?? "",
          o.warehouse_name ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, search]);

  const hasFilters = statusFilter !== "all" || search.trim() !== "";

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Track every purchase you've placed against attested stock."
      />

      <div
        className="tabs tabs-scroll"
        role="tablist"
        aria-label="Order status"
      >
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            className="tab"
            role="tab"
            aria-selected={statusFilter === t.value}
            data-active={statusFilter === t.value}
            onClick={() => {
              setStatusFilter(t.value);
              const url =
                t.value === "all"
                  ? "/buyer/orders"
                  : `/buyer/orders?status=${t.value}`;
              router.replace(url);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="input-line toolbar-search"
          placeholder="Search by order ID, SKU, or supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search orders"
        />
        {hasFilters && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setStatusFilter("all");
              setSearch("");
              router.replace("/buyer/orders");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="data-table-wrap buyer-orders-table desktop-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Warehouse</th>
              <th>Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 && (
              <tr className="data-table-empty">
                <td colSpan={6}>
                  <div
                    className="skeleton skeleton-line"
                    style={{ width: "40%", margin: "24px auto" }}
                  />
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr className="data-table-empty">
                <td colSpan={6}>
                  {orders.length === 0 ? (
                    <EmptyState
                      title="No orders yet"
                      description="Your orders will appear here after you place your first purchase."
                      action={
                        <button
                          className="btn btn-primary"
                          onClick={() => router.push("/buyer/stock")}
                        >
                          Browse stock
                        </button>
                      }
                    />
                  ) : (
                    <EmptyState
                      title="No orders match your filters"
                      description="Try a different search term or clear the status filter."
                    />
                  )}
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr
                key={o.id}
                onClick={() => router.push(`/buyer/orders/${o.id}`)}
              >
                <td>
                  <div className="row-title" style={{ marginBottom: 2 }}>
                    {o.sku}
                  </div>
                  <div className="row-sub mono">{o.id.slice(0, 8)}…</div>
                </td>
                <td>{new Date(o.created_at).toLocaleDateString()}</td>
                <td>{o.supplier_company_name ?? "—"}</td>
                <td>{o.warehouse_name ?? "—"}</td>
                <td className="mono">{o.quantity}</td>
                <td>
                  <Badge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-card-list buyer-order-cards">
        {!loading && filtered.length === 0 && orders.length === 0 && (
          <div className="panel panel-pad">
            <EmptyState
              title="No orders yet"
              description="Your orders will appear here after you place your first purchase."
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
        )}
        {!loading && filtered.length === 0 && orders.length > 0 && (
          <div className="panel panel-pad">
            <EmptyState
              title="No orders match your filters"
              description="Try a different search term or clear the status filter."
            />
          </div>
        )}
        {filtered.map((o) => (
          <button
            key={o.id}
            type="button"
            className="mobile-list-card buyer-order-card"
            onClick={() => router.push(`/buyer/orders/${o.id}`)}
          >
            <div className="mobile-list-card-top buyer-order-card-top">
              <div>
                <div className="row-title">{o.sku}</div>
                <div className="row-sub">
                  {new Date(o.created_at).toLocaleDateString()}
                </div>
              </div>
              <Badge status={o.status} />
            </div>
            <div className="row-sub">
              {o.supplier_company_name ?? "Supplier"}
              {o.warehouse_name ? ` · ${o.warehouse_name}` : ""}
              {" · "}
              qty {o.quantity}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BuyerOrdersPage() {
  return (
    <Suspense
      fallback={
        <div>
          <PageHeader
            title="Orders"
            description="Track every purchase you've placed against attested stock."
          />
          <div className="skeleton skeleton-block" style={{ height: 320 }} />
        </div>
      }
    >
      <OrdersContent />
    </Suspense>
  );
}
