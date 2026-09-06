"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { EmptyState, Overlay, PageHeader } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useSupplierData, type Warehouse } from "../SupplierDataContext";

interface Category {
  id: string;
  name: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function WarehousesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { warehouses, cameras, loading, refetchWarehouses } = useSupplierData();

  const [categoryOptions, setCategoryOptions] = useState<Category[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<Category[]>("/categories")
      .then(setCategoryOptions)
      .catch(() => setCategoryOptions([]));
  }, []);

  function toggleCategory(name: string) {
    setCategories((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    );
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhoto(file);
    setPhotoPreview(file ? await fileToDataUrl(file) : null);
  }

  function resetForm() {
    setShowAdd(false);
    setName("");
    setLocation("");
    setCategories([]);
    setPhoto(null);
    setPhotoPreview(null);
  }

  async function createWarehouse() {
    if (!name.trim() || categories.length === 0) return;
    setSaving(true);
    try {
      const imageBase64 = photo ? await fileToDataUrl(photo) : undefined;
      const warehouse = await apiPost<Warehouse>("/warehouses", {
        name: name.trim(),
        location: location.trim() || undefined,
        categories,
        imageBase64,
      });
      resetForm();
      await refetchWarehouses();
      showToast(
        "Warehouse created — add a camera to start publishing stock.",
        "success",
      );
      router.push(`/supplier/warehouses/${warehouse.id}?addCamera=1`);
    } catch {
      showToast("Couldn't create that warehouse.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Warehouses"
        description="Each warehouse keeps its own categories, photo, and cameras."
      />

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          Add warehouse
        </button>
      </div>

      {!loading && warehouses.length === 0 && (
        <div className="panel">
          <EmptyState
            title="No warehouses yet"
            description="Add your first warehouse to start registering cameras and publishing attested stock."
            action={
              <button
                className="btn btn-primary"
                onClick={() => setShowAdd(true)}
              >
                Add warehouse
              </button>
            }
          />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {warehouses.map((wh) => {
          const camCount = cameras.filter(
            (c) => c.warehouse_id === wh.id,
          ).length;
          const enrolledCount = cameras.filter(
            (c) =>
              c.warehouse_id === wh.id && c.enrollment_status === "enrolled",
          ).length;
          return (
            <div
              key={wh.id}
              className="panel warehouse-card"
              style={{ cursor: "pointer" }}
              onClick={() => router.push(`/supplier/warehouses/${wh.id}`)}
            >
              {wh.image_url ? (
                <img src={wh.image_url} alt="" className="warehouse-photo" />
              ) : (
                <div className="warehouse-photo-empty">No photo</div>
              )}
              <div className="warehouse-body">
                <div className="warehouse-header">
                  <div>
                    <div className="row-title">{wh.name}</div>
                    {wh.location && (
                      <div className="row-sub">{wh.location}</div>
                    )}
                  </div>
                  <span className="link-btn" style={{ marginTop: 0 }}>
                    View
                  </span>
                </div>
                <div className="warehouse-tags">
                  {wh.categories.map((c) => (
                    <span key={c} className="warehouse-tag">
                      {c}
                    </span>
                  ))}
                </div>
                <div className="row-sub">
                  {camCount === 0
                    ? "No cameras yet"
                    : `${enrolledCount} of ${camCount} camera${camCount === 1 ? "" : "s"} enrolled`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <Overlay onClose={resetForm}>
          <div className="overlay-title">Add warehouse</div>
          <div className="overlay-sub">
            Tag what this warehouse stocks and give buyers a photo of the floor.
          </div>

          <div className="field">
            <label htmlFor="wh-name">
              Warehouse name <span style={{ color: "var(--copper)" }}>*</span>
            </label>
            <input
              id="wh-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aisle 3 — Furniture"
            />
          </div>

          <div className="field">
            <label htmlFor="wh-location">Location</label>
            <input
              id="wh-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Kathmandu"
            />
          </div>

          <div className="field">
            <label>
              Categories <span style={{ color: "var(--copper)" }}>*</span>
            </label>
            <div className="category-picker">
              {categoryOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="category-chip"
                  data-active={categories.includes(c.name)}
                  onClick={() => toggleCategory(c.name)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Warehouse photo</label>
            <div className="file-field">
              {photoPreview && (
                <img src={photoPreview} alt="" className="file-field-preview" />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              className="btn btn-ghost"
              style={{ flex: 1 }}
              onClick={resetForm}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={createWarehouse}
              disabled={!name.trim() || categories.length === 0 || saving}
            >
              {saving ? "Creating…" : "Create warehouse"}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}
