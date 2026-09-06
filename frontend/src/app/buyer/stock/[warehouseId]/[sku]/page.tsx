"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, DetailRow, EmptyState, PageHeader } from "@/components/ui";
import { useBuyerData } from "../../../BuyerDataContext";
import { PlaceOrderDialog } from "../../../PlaceOrderDialog";

export default function StockDetailPage() {
  const params = useParams<{ warehouseId: string; sku: string }>();
  const warehouseId = params.warehouseId;
  const sku = decodeURIComponent(params.sku);
  const router = useRouter();
  const { findStock, loading, stock } = useBuyerData();
  const [ordering, setOrdering] = useState(false);

  const row = useMemo(
    () => findStock(warehouseId, sku),
    [findStock, warehouseId, sku],
  );

  if (loading && stock.length === 0) {
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

  if (!row) {
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
            description="This SKU may no longer be in the latest attestation for that warehouse."
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

  const { warehouse, attestation, item } = row;

  return (
    <div>
      <button className="link-btn" onClick={() => router.push("/buyer/stock")}>
        ← Back to catalog
      </button>

      <div className="product-detail" style={{ marginTop: 18 }}>
        <div className="product-detail-media">
          {warehouse.image_url ? (
            <img
              src={warehouse.image_url}
              alt={`${warehouse.name} warehouse`}
            />
          ) : (
            <div className="product-detail-media-empty">No warehouse photo</div>
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
              {item.count > 0 ? "Available" : "Out of stock"}
            </span>
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
            <button
              className="btn btn-primary"
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
            <div className="overlay-title" style={{ marginBottom: 14 }}>
              Attestation
            </div>
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
            <DetailRow label="Image hash" value={attestation.image_hash} mono />
            <DetailRow label="Model hash" value={attestation.model_hash} mono />
          </div>
        </div>
      </div>

      {ordering && (
        <PlaceOrderDialog target={row} onClose={() => setOrdering(false)} />
      )}
    </div>
  );
}
