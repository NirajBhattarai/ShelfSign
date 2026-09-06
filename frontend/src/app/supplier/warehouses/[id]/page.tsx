"use client";

import { Suspense } from "react";
import WarehouseDetailClient from "./WarehouseDetailClient";

export default function WarehouseDetailPage() {
  return (
    <Suspense
      fallback={
        <div>
          <div
            className="skeleton skeleton-line"
            style={{ width: 140, marginBottom: 20 }}
          />
          <div
            className="skeleton skeleton-block"
            style={{ height: 180, marginBottom: 16 }}
          />
          <div className="skeleton skeleton-block" style={{ height: 240 }} />
        </div>
      }
    >
      <WarehouseDetailClient />
    </Suspense>
  );
}
