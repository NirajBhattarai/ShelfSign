"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { useSupplierData, type OrderStatus } from "../SupplierDataContext";

type StatusFilter = "all" | OrderStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "New" },
  { value: "confirmed", label: "Processing" },
  { value: "fulfilled", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

function OrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orders, loading } = useSupplierData();

  const initialStatus = (searchParams.get("status") as StatusFilter) ?? "all";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    STATUS_TABS.some((t) => t.value === initialStatus) ? initialStatus : "all",
  );
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const warehouseNames = useMemo(
    () => [
      ...new Set(
        orders.map((o) => o.warehouse_name).filter((n): n is string => !!n),
      ),
    ],
    [orders],
  );

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (warehouseFilter !== "all" && o.warehouse_name !== warehouseFilter)
        return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matches =
          o.id.toLowerCase().includes(q) ||
          o.sku.toLowerCase().includes(q) ||
          (o.buyer_company_name ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [orders, statusFilter, warehouseFilter, search]);

  const hasFilters =
    statusFilter !== "all" || warehouseFilter !== "all" || search.trim() !== "";

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every order placed against your attested stock."
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
                  ? "/supplier/orders"
                  : `/supplier/orders?status=${t.value}`;
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
          placeholder="Search by order ID, SKU, or buyer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search orders"
        />
        {warehouseNames.length > 0 && (
          <select
            className="input-line"
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            aria-label="Filter by warehouse"
          >
            <option value="all">All warehouses</option>
            {warehouseNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
        {hasFilters && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setStatusFilter("all");
              setWarehouseFilter("all");
              setSearch("");
              router.replace("/supplier/orders");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="data-table-wrap desktop-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Buyer</th>
              <th>Warehouse</th>
              <th>Placed</th>
              <th>Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr className="data-table-empty">
                <td colSpan={6}>
                  {orders.length === 0 ? (
                    <EmptyState
                      title="No orders yet"
                      description="Orders will show up here as soon as a buyer orders from one of your warehouses."
                    />
                  ) : (
                    <EmptyState
                      title="No orders match your filters"
                      description="Try clearing the search or filters."
                    />
                  )}
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr
                key={o.id}
                onClick={() => router.push(`/supplier/orders/${o.id}`)}
              >
                <td className="mono">{o.sku}</td>
                <td>{o.buyer_company_name ?? "—"}</td>
                <td>{o.warehouse_name ?? "—"}</td>
                <td>{new Date(o.created_at).toLocaleDateString()}</td>
                <td className="mono">{o.quantity}</td>
                <td>
                  <Badge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-card-list">
        {!loading && filtered.length === 0 && (
          <div className="panel panel-pad">
            {orders.length === 0 ? (
              <EmptyState
                title="No orders yet"
                description="Orders will show up here as soon as a buyer orders from one of your warehouses."
              />
            ) : (
              <EmptyState
                title="No orders match your filters"
                description="Try clearing the search or filters."
              />
            )}
          </div>
        )}
        {filtered.map((o) => (
          <button
            key={o.id}
            type="button"
            className="mobile-list-card"
            onClick={() => router.push(`/supplier/orders/${o.id}`)}
          >
            <div className="mobile-list-card-top">
              <div>
                <div className="row-title">{o.sku}</div>
                <div className="row-sub">
                  {new Date(o.created_at).toLocaleDateString()}
                </div>
              </div>
              <Badge status={o.status} />
            </div>
            <div className="row-sub">
              {o.buyer_company_name ?? "Buyer"}
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

export default function OrdersPage() {
  return (
    <Suspense
      fallback={
        <div>
          <PageHeader
            title="Orders"
            description="Every order placed against your attested stock."
          />
          <div className="skeleton skeleton-block" style={{ height: 320 }} />
        </div>
      }
    >
      <OrdersContent />
    </Suspense>
  );
}
