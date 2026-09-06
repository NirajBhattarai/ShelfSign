"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import {
  Badge,
  LedStatus,
  Ledger,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { useSupplierData } from "./SupplierDataContext";

export default function SupplierOverview() {
  const router = useRouter();
  const { profile } = useProfile();
  const { orders, warehouses, cameras, loading } = useSupplierData();

  const newOrders = useMemo(
    () => orders.filter((o) => o.status === "pending"),
    [orders],
  );
  const processingOrders = useMemo(
    () => orders.filter((o) => o.status === "confirmed"),
    [orders],
  );
  const receivedOrders = useMemo(
    () => orders.filter((o) => o.status === "fulfilled"),
    [orders],
  );

  const failedCameras = useMemo(
    () => cameras.filter((c) => c.enrollment_status === "failed"),
    [cameras],
  );
  const warehouseIdsWithCameras = useMemo(
    () => new Set(cameras.map((c) => c.warehouse_id)),
    [cameras],
  );
  const warehousesNeedingCamera = warehouses.filter(
    (w) => !warehouseIdsWithCameras.has(w.id),
  );
  const pendingActions = failedCameras.length + warehousesNeedingCamera.length;

  const recentOrders = orders.slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`Good day, ${profile?.company_name ?? "there"}`}
        description="Here's what's happening with your orders and warehouses today."
      />

      <div className="stat-grid">
        <StatCard
          label="New orders"
          value={loading ? "—" : newOrders.length}
          note="Awaiting confirmation"
          onClick={() => router.push("/supplier/orders?status=pending")}
        />
        <StatCard
          label="Processing"
          value={loading ? "—" : processingOrders.length}
          note="Confirmed, not yet received"
          onClick={() => router.push("/supplier/orders?status=confirmed")}
        />
        <StatCard
          label="Received"
          value={loading ? "—" : receivedOrders.length}
          note="Fulfilled orders"
          onClick={() => router.push("/supplier/orders?status=fulfilled")}
        />
        <StatCard
          label="Warehouses"
          value={loading ? "—" : warehouses.length}
          note="Registered locations"
          onClick={() => router.push("/supplier/warehouses")}
        />
        <StatCard
          label="Needs attention"
          value={loading ? "—" : pendingActions}
          note={
            pendingActions > 0
              ? "Failed cameras or warehouses with none"
              : "Nothing needs attention"
          }
          onClick={() => router.push("/supplier/warehouses")}
        />
      </div>

      <div className="page-header" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          Recent orders
        </h2>
      </div>

      <Ledger empty="No orders yet — they'll show up here as buyers order from your warehouses.">
        {recentOrders.map((o) => (
          <div
            key={o.id}
            className="ledger-row"
            style={{ cursor: "pointer" }}
            onClick={() => router.push(`/supplier/orders/${o.id}`)}
          >
            <div>
              <div className="row-title">
                {o.sku} × {o.quantity}
              </div>
              <div className="row-sub">
                {o.buyer_company_name ?? "Unknown buyer"}
              </div>
            </div>
            <Badge status={o.status} />
          </div>
        ))}
      </Ledger>

      {warehousesNeedingCamera.length > 0 && (
        <>
          <div
            className="page-header"
            style={{ marginTop: 28, marginBottom: 14 }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
              Warehouses with no camera yet
            </h2>
          </div>
          <Ledger empty="">
            {warehousesNeedingCamera.map((w) => (
              <div
                key={w.id}
                className="ledger-row"
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/supplier/warehouses/${w.id}`)}
              >
                <div className="row-title">{w.name}</div>
                <span className="link-btn" style={{ marginTop: 0 }}>
                  Add a camera
                </span>
              </div>
            ))}
          </Ledger>
        </>
      )}

      {failedCameras.length > 0 && (
        <>
          <div
            className="page-header"
            style={{ marginTop: 28, marginBottom: 14 }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
              Cameras that failed enrollment
            </h2>
          </div>
          <Ledger empty="">
            {failedCameras.map((c) => {
              const wh = warehouses.find((w) => w.id === c.warehouse_id);
              return (
                <div
                  key={c.id}
                  className="ledger-row"
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    wh && router.push(`/supplier/warehouses/${wh.id}`)
                  }
                >
                  <div>
                    <div className="row-title">{c.label}</div>
                    <div className="row-sub">
                      {wh?.name ?? "Unknown warehouse"}
                    </div>
                  </div>
                  <LedStatus status={c.enrollment_status} />
                </div>
              );
            })}
          </Ledger>
        </>
      )}
    </div>
  );
}
