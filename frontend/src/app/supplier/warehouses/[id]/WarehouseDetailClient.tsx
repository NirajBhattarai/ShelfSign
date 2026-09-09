"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { Badge, EmptyState, LedStatus, Ledger, Overlay } from "@/components/ui";
import { AttestWizard } from "@/components/AttestWizard";
import { useToast } from "@/components/toast";
import { useSupplierData, type Camera } from "../../SupplierDataContext";

interface StockRow {
  id?: string;
  sku: string;
  quantity: number;
  shelf: string;
}

/** Warehouse category label ↔ stock SKU code. */
const CATEGORY_TO_SKU: Record<string, string> = {
  Chair: "CHAIR",
  Monitor: "MONITOR",
  Table: "TABLE",
};

const SKU_TO_CATEGORY: Record<string, string> = {
  CHAIR: "Chair",
  MONITOR: "Monitor",
  TABLE: "Table",
};

function categoryForSku(sku: string): string {
  return SKU_TO_CATEGORY[sku.toUpperCase()] ?? sku;
}

function skuForCategory(category: string): string {
  return (
    CATEGORY_TO_SKU[category] ?? category.toUpperCase().replace(/\s+/g, "_")
  );
}

function parseNonNegativeInt(raw: string): number {
  if (raw.trim() === "") return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export default function WarehouseDetailClient() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();
  const { warehouses, cameras, orders, loading, refetchCameras } =
    useSupplierData();

  const warehouse = warehouses.find((w) => w.id === id);
  const warehouseCameras = cameras.filter((c) => c.warehouse_id === id);
  const warehouseOrders = warehouse
    ? orders.filter((o) => o.warehouse_name === warehouse.name)
    : [];

  const [showAddCamera, setShowAddCamera] = useState(
    searchParams.get("addCamera") === "1",
  );
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [viewingCamera, setViewingCamera] = useState<Camera | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [attestingCamera, setAttestingCamera] = useState<Camera | null>(null);
  const [restakingId, setRestakingId] = useState<string | null>(null);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [savingStock, setSavingStock] = useState(false);

  useEffect(() => {
    if (searchParams.get("addCamera") === "1") setShowAddCamera(true);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setStockLoading(true);
    apiGet<StockRow[]>(`/warehouses/${id}/stock`)
      .then((rows) => {
        if (!cancelled) {
          setStockRows(
            rows.map((r) => ({
              id: r.id,
              sku: r.sku,
              quantity: r.quantity,
              shelf: r.shelf ?? "",
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setStockRows([]);
      })
      .finally(() => {
        if (!cancelled) setStockLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function resetCameraForm() {
    setShowAddCamera(false);
    setLabel("");
    setError(null);
  }

  async function registerCamera() {
    if (!label.trim()) return;
    setRegistering(true);
    setError(null);
    try {
      // Host/user/pass come from backend system_settings (SiliconWitness
      // defaults) — never collected or hardcoded on the frontend.
      await apiPost<Camera>("/cameras", {
        warehouseId: id,
        label: label.trim(),
      });
      await refetchCameras();
      resetCameraForm();
      showToast("Camera registered.", "success");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't enroll that camera — check backend camera settings and try again.",
      );
    } finally {
      setRegistering(false);
    }
  }

  async function restakeEscrow(cam: Camera) {
    setRestakingId(cam.id);
    try {
      await apiPost<Camera>(`/cameras/${cam.id}/restake`);
      await refetchCameras();
      showToast("Escrow restaked — fraud flag cleared.", "success");
    } catch {
      showToast(
        "Restake failed — check backend escrow config and try again.",
        "error",
      );
    } finally {
      setRestakingId(null);
    }
  }

  async function openLiveView(cam: Camera) {
    try {
      // Stream URL is built on the backend from system_settings.public_api_url.
      const { url } = await apiGet<{ url: string }>(
        `/cameras/${cam.id}/stream-url`,
      );
      setViewingCamera(cam);
      setStreamUrl(url);
    } catch {
      showToast("Couldn't open live view.", "error");
    }
  }

  function closeLiveView() {
    setViewingCamera(null);
    setStreamUrl(null);
  }

  function addStockRow() {
    const used = new Set(stockRows.map((r) => r.sku.toUpperCase()));
    const nextCategory =
      (warehouse?.categories ?? []).find((c) => !used.has(skuForCategory(c))) ??
      warehouse?.categories?.[0] ??
      "Chair";
    setStockRows((prev) => [
      ...prev,
      {
        sku: skuForCategory(nextCategory),
        quantity: 0,
        shelf: "",
      },
    ]);
  }

  function updateStockRow(
    index: number,
    patch: Partial<Pick<StockRow, "sku" | "quantity" | "shelf">>,
  ) {
    setStockRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeStockRow(index: number) {
    setStockRows((prev) => prev.filter((_, i) => i !== index));
  }

  function setStockQuantity(index: number, raw: string) {
    updateStockRow(index, { quantity: parseNonNegativeInt(raw) });
  }

  async function saveStock() {
    setSavingStock(true);
    try {
      const items = stockRows
        .map((r) => ({
          sku: r.sku.trim().toUpperCase(),
          quantity: Math.max(0, Math.floor(Number(r.quantity) || 0)),
          shelf: r.shelf.trim(),
        }))
        .filter((r) => r.sku);
      const saved = await apiPut<StockRow[]>(`/warehouses/${id}/stock`, {
        items,
      });
      setStockRows(
        saved.map((r) => ({
          id: r.id,
          sku: r.sku,
          quantity: r.quantity,
          shelf: r.shelf ?? "",
        })),
      );
      showToast(
        "Declared stock saved. Attestation does not change these amounts.",
        "success",
      );
    } catch {
      showToast("Couldn't save stock.", "error");
    } finally {
      setSavingStock(false);
    }
  }

  if (loading) return null;

  if (!warehouse) {
    return (
      <div>
        <button
          className="link-btn"
          onClick={() => router.push("/supplier/warehouses")}
        >
          ← Back to warehouses
        </button>
        <div className="panel" style={{ marginTop: 16 }}>
          <EmptyState
            title="Warehouse not found"
            description="This warehouse doesn't exist, or it isn't one of yours."
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        className="link-btn"
        onClick={() => router.push("/supplier/warehouses")}
      >
        ← Back to warehouses
      </button>

      <div
        className="panel warehouse-card"
        style={{ marginTop: 16, marginBottom: 28 }}
      >
        {warehouse.image_url ? (
          <img src={warehouse.image_url} alt="" className="warehouse-photo" />
        ) : (
          <div className="warehouse-photo-empty">No photo</div>
        )}
        <div className="warehouse-body">
          <div className="warehouse-header">
            <div>
              <h1 className="warehouse-detail-title">{warehouse.name}</h1>
              {warehouse.location && (
                <div className="row-sub">{warehouse.location}</div>
              )}
            </div>
            <button
              className="btn btn-primary warehouse-detail-action"
              onClick={() => setShowAddCamera(true)}
            >
              Add camera
            </button>
          </div>
          <div className="warehouse-tags">
            {warehouse.categories.map((c) => (
              <span key={c} className="warehouse-tag">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="page-header" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Cameras</h2>
      </div>
      <Ledger empty="No cameras yet — register one to start publishing attested stock.">
        {warehouseCameras.map((cam) => {
          const attestBusy = Boolean(
            cam.attest_locked_at &&
            Date.now() - new Date(cam.attest_locked_at).getTime() <
              3 * 60 * 1000,
          );
          return (
            <div key={cam.id} className="ledger-row">
              <div>
                <div
                  className="row-title"
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {cam.label}
                  {cam.is_fake ? (
                    <span className="meta-chip" data-tone="danger">
                      Unverified
                    </span>
                  ) : (
                    <span className="meta-chip" data-tone="ok">
                      Verified camera
                    </span>
                  )}
                  {cam.escrow_status === "forfeited" ? (
                    <span className="meta-chip" data-tone="danger">
                      Bond slashed
                    </span>
                  ) : cam.enrollment_status === "enrolled" &&
                    cam.escrow_status !== "locked" ? (
                    <span className="meta-chip" data-tone="danger">
                      Bond required
                    </span>
                  ) : null}
                  {attestBusy ? (
                    <span className="meta-chip" data-tone="warn">
                      Attest in progress
                    </span>
                  ) : null}
                </div>
                <div className="row-sub mono">{cam.host}</div>
                {cam.is_fake ? (
                  <div className="row-sub" style={{ marginTop: 4 }}>
                    Camera identity check failed
                    {cam.fraud_detected_at
                      ? ` · ${new Date(cam.fraud_detected_at).toLocaleString()}`
                      : ""}
                    . Buyers will see a trust warning for this warehouse.
                  </div>
                ) : null}
                {cam.escrow_status === "locked" && (
                  <div className="row-sub" style={{ marginTop: 4 }}>
                    HBAR bond locked
                    {cam.escrow_amount != null
                      ? ` · ${(cam.escrow_amount / 100_000_000).toFixed(2)} ℏ`
                      : ""}
                    {cam.escrow_hashscan_url ? (
                      <>
                        {" · "}
                        <a
                          href={cam.escrow_hashscan_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          HashScan
                        </a>
                      </>
                    ) : null}
                  </div>
                )}
                {cam.escrow_status === "forfeited" && (
                  <div className="row-sub" style={{ marginTop: 4 }}>
                    HBAR bond slashed for fraud
                    {cam.escrow_forfeited_at
                      ? ` · ${new Date(cam.escrow_forfeited_at).toLocaleString()}`
                      : ""}
                    {cam.escrow_slash_hashscan_url ? (
                      <>
                        {" · "}
                        <a
                          href={cam.escrow_slash_hashscan_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          HashScan
                        </a>
                      </>
                    ) : null}
                    . Attestation is paused until the bond is restaked.
                  </div>
                )}
                {cam.enrollment_status === "enrolled" && !cam.escrow_status && (
                  <div className="row-sub" style={{ marginTop: 4 }}>
                    No HBAR bond on file for this camera. Attestation is paused
                    until 10 ℏ is staked.
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                {cam.enrollment_status === "enrolled" &&
                  cam.escrow_status !== "locked" && (
                    <button
                      className="btn btn-primary"
                      style={{ padding: "8px 12px" }}
                      disabled={restakingId === cam.id}
                      onClick={() => restakeEscrow(cam)}
                    >
                      {restakingId === cam.id
                        ? "Staking…"
                        : cam.escrow_status === "forfeited"
                          ? "Restake 10 HBAR"
                          : "Stake 10 HBAR"}
                    </button>
                  )}
                {cam.enrollment_status === "enrolled" && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: "8px 12px" }}
                    disabled={attestBusy || cam.escrow_status !== "locked"}
                    title={
                      cam.escrow_status === "forfeited"
                        ? "Bond was slashed — restake before attesting"
                        : cam.escrow_status !== "locked"
                          ? "No HBAR bond on file — stake before attesting"
                          : attestBusy
                            ? "Another attestation is running on this camera"
                            : undefined
                    }
                    onClick={() => setAttestingCamera(cam)}
                  >
                    {attestBusy ? "Attesting…" : "Pay & attest"}
                  </button>
                )}
                <button
                  className="link-btn"
                  style={{ marginTop: 0 }}
                  onClick={() => openLiveView(cam)}
                >
                  View live
                </button>
                <LedStatus status={cam.enrollment_status} />
              </div>
            </div>
          );
        })}
      </Ledger>

      <div className="page-header" style={{ marginTop: 28, marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          Declared stock (orderable)
        </h2>
      </div>
      <p className="row-sub" style={{ marginBottom: 12 }}>
        Set how many of each warehouse item buyers can order. Camera attestation
        is evidence only — it does not overwrite these amounts.
      </p>
      <div className="panel panel-pad" style={{ marginBottom: 8 }}>
        {stockLoading ? (
          <div className="row-sub">Loading stock…</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stockRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="row-sub">
                    No items yet — add Chair, Monitor, or Table from this
                    warehouse.
                  </td>
                </tr>
              ) : (
                stockRows.map((row, index) => {
                  const selectedCategory = categoryForSku(row.sku);
                  const usedElsewhere = new Set(
                    stockRows
                      .filter((_, i) => i !== index)
                      .map((r) => r.sku.toUpperCase()),
                  );
                  const options = (warehouse?.categories ?? []).filter(
                    (c) =>
                      skuForCategory(c) === row.sku.toUpperCase() ||
                      !usedElsewhere.has(skuForCategory(c)),
                  );
                  // Keep current selection visible even if not in warehouse list.
                  if (selectedCategory && !options.includes(selectedCategory)) {
                    options.unshift(selectedCategory);
                  }

                  return (
                    <tr key={row.id ?? `new-${index}`}>
                      <td>
                        <select
                          className="input-line"
                          aria-label="Item"
                          value={selectedCategory}
                          onChange={(e) =>
                            updateStockRow(index, {
                              sku: skuForCategory(e.target.value),
                            })
                          }
                          style={{ width: "100%", minWidth: 140 }}
                        >
                          {options.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="input-line mono"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          aria-label={`Quantity for ${selectedCategory}`}
                          value={row.quantity}
                          onChange={(e) =>
                            setStockQuantity(index, e.target.value)
                          }
                          onKeyDown={(e) => {
                            if (
                              e.key === "-" ||
                              e.key === "e" ||
                              e.key === "+"
                            ) {
                              e.preventDefault();
                            }
                          }}
                          onBlur={() =>
                            updateStockRow(index, {
                              quantity: Math.max(
                                0,
                                Math.floor(Number(row.quantity) || 0),
                              ),
                            })
                          }
                          style={{ width: 100 }}
                        />
                      </td>
                      <td>
                        <button
                          className="link-btn"
                          type="button"
                          onClick={() => removeStockRow(index)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={addStockRow}
            disabled={
              stockLoading ||
              ((warehouse?.categories.length ?? 0) > 0 &&
                stockRows.length >= (warehouse?.categories.length ?? 0))
            }
          >
            Add item
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={saveStock}
            disabled={savingStock || stockLoading}
          >
            {savingStock ? "Saving…" : "Save stock"}
          </button>
        </div>
      </div>

      <div className="page-header" style={{ marginTop: 28, marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          Orders from this warehouse
        </h2>
      </div>
      <Ledger empty="No orders linked to this warehouse yet.">
        {warehouseOrders.map((o) => (
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

      {showAddCamera && (
        <Overlay onClose={resetCameraForm}>
          <div className="overlay-title">Add camera</div>
          <div className="overlay-sub">
            Name this camera. Connection details and SiliconWitness PUF
            enrollment use backend database settings — not the browser.
          </div>

          <div className="field">
            <label htmlFor="cam-label">Camera label</label>
            <input
              id="cam-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Aisle 3 overhead"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && registerCamera()}
            />
          </div>

          {error && <div className="field-error">{error}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              className="btn btn-ghost"
              style={{ flex: 1 }}
              onClick={resetCameraForm}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={registerCamera}
              disabled={!label.trim() || registering}
            >
              {registering ? "Enrolling…" : "Save & enroll"}
            </button>
          </div>
        </Overlay>
      )}

      {viewingCamera && streamUrl && (
        <Overlay onClose={closeLiveView} wide>
          <div className="overlay-title">{viewingCamera.label}</div>
          <div className="overlay-sub">
            {viewingCamera.host} · near-live, a few frames per second — not full
            video
          </div>
          <img src={streamUrl} alt="" className="camera-live-view" />
        </Overlay>
      )}

      {attestingCamera && (
        <AttestWizard
          camera={attestingCamera}
          onClose={() => setAttestingCamera(null)}
          onComplete={() => {
            void refetchCameras();
          }}
        />
      )}
    </div>
  );
}
