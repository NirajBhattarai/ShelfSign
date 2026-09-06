"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { Badge, EmptyState, LedStatus, Ledger, Overlay } from "@/components/ui";
import { AttestWizard } from "@/components/AttestWizard";
import { useToast } from "@/components/toast";
import { useSupplierData, type Camera } from "../../SupplierDataContext";

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

  useEffect(() => {
    if (searchParams.get("addCamera") === "1") setShowAddCamera(true);
  }, [searchParams]);

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
    } catch {
      setError(
        "Couldn't enroll that camera — check backend camera settings and try again.",
      );
    } finally {
      setRegistering(false);
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
        {warehouseCameras.map((cam) => (
          <div key={cam.id} className="ledger-row">
            <div>
              <div className="row-title">{cam.label}</div>
              <div className="row-sub mono">{cam.host}</div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {cam.enrollment_status === "enrolled" && (
                <button
                  className="btn btn-primary"
                  style={{ padding: "8px 12px" }}
                  onClick={() => setAttestingCamera(cam)}
                >
                  Attest stock
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
        ))}
      </Ledger>

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
          onComplete={() =>
            showToast("Stock attestation published.", "success")
          }
        />
      )}
    </div>
  );
}
