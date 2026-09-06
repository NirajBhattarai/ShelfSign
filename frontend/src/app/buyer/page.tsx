"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import {
  Badge,
  EmptyState,
  Ledger,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { useBuyerData } from "./BuyerDataContext";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function BuyerHome() {
  const router = useRouter();
  const { profile } = useProfile();
  const { orders, stock, loading, stockError, refetchStock } = useBuyerData();

  const pending = useMemo(
    () => orders.filter((o) => o.status === "pending"),
    [orders],
  );
  const confirmed = useMemo(
    () => orders.filter((o) => o.status === "confirmed"),
    [orders],
  );
  const fulfilled = useMemo(
    () => orders.filter((o) => o.status === "fulfilled"),
    [orders],
  );
  const active = pending.length + confirmed.length;

  const recentOrders = orders.slice(0, 6);
  const recentStock = stock.slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${profile?.company_name ?? "there"}`}
        description="Here's an overview of your purchasing activity."
      />

      <div className="stat-grid">
        <StatCard
          label="Active orders"
          value={loading ? "—" : active}
          note={
            pending.length > 0
              ? `${pending.length} awaiting supplier confirmation`
              : confirmed.length > 0
                ? `${confirmed.length} confirmed`
                : "Nothing in flight"
          }
          onClick={() => router.push("/buyer/orders?status=pending")}
        />
        <StatCard
          label="Confirmed"
          value={loading ? "—" : confirmed.length}
          note="Supplier is fulfilling"
          onClick={() => router.push("/buyer/orders?status=confirmed")}
        />
        <StatCard
          label="Fulfilled"
          value={loading ? "—" : fulfilled.length}
          note="Completed purchases"
          onClick={() => router.push("/buyer/orders?status=fulfilled")}
        />
        <StatCard
          label="Available SKUs"
          value={loading ? "—" : stock.length}
          note="Camera-attested stock"
          onClick={() => router.push("/buyer/stock")}
        />
      </div>

      <div className="buyer-home-grid">
        <section>
          <div className="section-head">
            <h2>Recent orders</h2>
            <button
              className="link-btn"
              style={{ marginTop: 0 }}
              onClick={() => router.push("/buyer/orders")}
            >
              View all
            </button>
          </div>
          <Ledger empty="No orders yet — browse attested stock to place your first purchase.">
            {recentOrders.map((o) => (
              <div
                key={o.id}
                className="ledger-row"
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/buyer/orders/${o.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/buyer/orders/${o.id}`);
                  }
                }}
                role="link"
                tabIndex={0}
              >
                <div>
                  <div className="row-title">
                    {o.sku} × {o.quantity}
                  </div>
                  <div className="row-sub">
                    {o.supplier_company_name ?? "Supplier"}
                    {o.warehouse_name ? ` · ${o.warehouse_name}` : ""}
                    {" · "}
                    {new Date(o.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Badge status={o.status} />
              </div>
            ))}
          </Ledger>
        </section>

        <section>
          <div className="section-head">
            <h2>Available stock</h2>
            <button
              className="link-btn"
              style={{ marginTop: 0 }}
              onClick={() => router.push("/buyer/stock")}
            >
              Browse catalog
            </button>
          </div>

          {stockError ? (
            <div className="panel panel-pad">
              <EmptyState
                title="Couldn't load stock"
                description={stockError}
                action={
                  <button
                    className="btn btn-primary"
                    onClick={() => refetchStock()}
                  >
                    Try again
                  </button>
                }
              />
            </div>
          ) : (
            <Ledger empty="No attested stock yet — check back once a supplier's camera reports in.">
              {recentStock.map((row) => (
                <div
                  key={`${row.attestation.id}-${row.item.sku}`}
                  className="ledger-row"
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    router.push(
                      `/buyer/stock/${row.warehouse.id}/${encodeURIComponent(row.item.sku)}`,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(
                        `/buyer/stock/${row.warehouse.id}/${encodeURIComponent(row.item.sku)}`,
                      );
                    }
                  }}
                  role="link"
                  tabIndex={0}
                >
                  <div
                    style={{ display: "flex", gap: 12, alignItems: "center" }}
                  >
                    {row.warehouse.image_url ? (
                      <img
                        src={row.warehouse.image_url}
                        alt=""
                        className="row-thumb"
                      />
                    ) : (
                      <div className="row-thumb-empty" />
                    )}
                    <div>
                      <div className="row-title">{row.item.sku}</div>
                      <div className="row-sub">
                        {row.warehouse.profiles?.company_name} ·{" "}
                        {row.warehouse.name}
                      </div>
                    </div>
                  </div>
                  <div className="row-figure">
                    <div className="row-figure-value">{row.item.count}</div>
                    <div className="row-figure-unit">units</div>
                  </div>
                </div>
              ))}
            </Ledger>
          )}
        </section>
      </div>
    </div>
  );
}
