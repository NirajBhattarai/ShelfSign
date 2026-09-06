import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";

export const warehouseRouter = Router();

const PHOTO_BUCKET = "warehouse-photos";
const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

interface CreateWarehouseBody {
  name: string;
  location?: string;
  categories: string[];
  // data URL from a <input type="file"> read client-side, e.g. "data:image/jpeg;base64,...."
  imageBase64?: string;
}

async function uploadWarehousePhoto(supplierId: string, dataUrl: string) {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return { error: "invalid_image" as const };

  const [, contentType, base64Data] = match;
  const ext = contentType.split("/")[1] ?? "jpg";
  const path = `${supplierId}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(base64Data, "base64");

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, buffer, { contentType });
  if (error) return { error: "upload_failed" as const, details: error.message };

  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

warehouseRouter.use(requireAuth);

// Suppliers create a warehouse (with its own categories + photo) before
// registering any camera to it — a supplier selling furniture out of one
// warehouse and produce out of another tags each independently.
warehouseRouter.post("/", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const { name, location, categories, imageBase64 } = (req.body ??
    {}) as Partial<CreateWarehouseBody>;
  if (!name?.trim() || !Array.isArray(categories) || categories.length === 0) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  let imageUrl: string | null = null;
  if (imageBase64) {
    const uploaded = await uploadWarehousePhoto(req.user!.id, imageBase64);
    if ("error" in uploaded) {
      res.status(400).json({ error: uploaded.error });
      return;
    }
    imageUrl = uploaded.url;
  }

  const { data, error } = await supabase
    .from("warehouses")
    .insert({
      supplier_id: req.user!.id,
      name: name.trim(),
      location: location?.trim() || null,
      categories,
      image_url: imageUrl,
    })
    .select()
    .single();

  if (error || !data) {
    res.status(500).json({ error: "warehouse_create_failed" });
    return;
  }
  res.status(201).json(data);
});

// A supplier's own warehouses, for the supplier dashboard.
warehouseRouter.get("/", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const { data, error } = await supabase
    .from("warehouses")
    .select("*")
    .eq("supplier_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});

// Buyer browsing surface: every warehouse, across every supplier,
// optionally filtered by one of its backend-defined categories.
warehouseRouter.get("/browse", async (req, res) => {
  const category =
    typeof req.query.category === "string" ? req.query.category : null;

  let query = supabase
    .from("warehouses")
    .select(
      "id, name, location, categories, image_url, supplier_id, profiles(company_name)",
    )
    .order("created_at", { ascending: false });

  if (category) query = query.contains("categories", [category]);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});

type CatalogSort = "sku" | "count" | "supplier" | "captured";

interface CatalogRow {
  warehouse: {
    id: string;
    name: string;
    location: string | null;
    categories: string[];
    image_url: string | null;
    supplier_id: string;
    profiles: { company_name: string } | null;
  };
  attestation: {
    id: string;
    camera_account: string;
    nonce: string;
    image_hash: string;
    model_hash: string;
    captured_at: string;
  };
  item: {
    sku: string;
    count: number;
    confidence: number;
    shelf: string;
  };
}

// Flattened, filterable, paginated stock catalog for the buyer UI.
warehouseRouter.get("/catalog", async (req, res) => {
  const q =
    typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const category =
    typeof req.query.category === "string" && req.query.category !== "all"
      ? req.query.category
      : null;
  const supplierId =
    typeof req.query.supplierId === "string" && req.query.supplierId !== "all"
      ? req.query.supplierId
      : null;
  const availability =
    typeof req.query.availability === "string" ? req.query.availability : "all";
  const sort = (
    typeof req.query.sort === "string" ? req.query.sort : "sku"
  ) as CatalogSort;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(
    48,
    Math.max(1, parseInt(String(req.query.limit ?? "12"), 10) || 12),
  );

  const { data: warehouses, error: whError } = await supabase
    .from("warehouses")
    .select(
      "id, name, location, categories, image_url, supplier_id, profiles(company_name)",
    )
    .order("created_at", { ascending: false });

  if (whError) {
    res.status(500).json({ error: "query_failed" });
    return;
  }

  const warehouseList: CatalogRow["warehouse"][] = (
    (warehouses ?? []) as unknown as Array<Record<string, unknown>>
  ).map((raw) => {
    const profilesRaw = raw.profiles;
    const profile = Array.isArray(profilesRaw)
      ? (profilesRaw[0] as { company_name: string } | undefined)
      : (profilesRaw as { company_name: string } | null);
    return {
      id: String(raw.id),
      name: String(raw.name),
      location: (raw.location as string | null) ?? null,
      categories: (raw.categories as string[]) ?? [],
      image_url: (raw.image_url as string | null) ?? null,
      supplier_id: String(raw.supplier_id),
      profiles: profile?.company_name
        ? { company_name: profile.company_name }
        : null,
    };
  });
  const filteredWarehouses = warehouseList.filter((wh) => {
    if (category && !wh.categories.includes(category)) return false;
    if (supplierId && wh.supplier_id !== supplierId) return false;
    return true;
  });

  const rows: CatalogRow[] = [];
  await Promise.all(
    filteredWarehouses.map(async (wh) => {
      const { data: cameras } = await supabase
        .from("cameras")
        .select("id")
        .eq("warehouse_id", wh.id);
      const cameraIds = (cameras ?? []).map((c) => c.id as string);
      if (cameraIds.length === 0) return;

      const { data: attestations } = await supabase
        .from("attestations")
        .select(
          "id, camera_account, nonce, image_hash, model_hash, items, captured_at",
        )
        .in("camera_id", cameraIds)
        .order("captured_at", { ascending: false });

      for (const att of attestations ?? []) {
        const items = (att.items ?? []) as CatalogRow["item"][];
        for (const item of items) {
          rows.push({
            warehouse: wh,
            attestation: {
              id: att.id,
              camera_account: att.camera_account,
              nonce: att.nonce,
              image_hash: att.image_hash,
              model_hash: att.model_hash,
              captured_at: att.captured_at,
            },
            item,
          });
        }
      }
    }),
  );

  let filtered = rows.filter((row) => {
    if (availability === "in_stock" && row.item.count < 1) return false;
    if (availability === "low" && (row.item.count < 1 || row.item.count > 10))
      return false;
    if (q) {
      const hay = [
        row.item.sku,
        row.warehouse.name,
        row.warehouse.profiles?.company_name ?? "",
        row.item.shelf,
        ...row.warehouse.categories,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    switch (sort) {
      case "count":
        return b.item.count - a.item.count;
      case "supplier":
        return (a.warehouse.profiles?.company_name ?? "").localeCompare(
          b.warehouse.profiles?.company_name ?? "",
        );
      case "captured":
        return (
          new Date(b.attestation.captured_at).getTime() -
          new Date(a.attestation.captured_at).getTime()
        );
      default:
        return a.item.sku.localeCompare(b.item.sku);
    }
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const items = filtered.slice(start, start + limit);

  const categories = [
    ...new Set(warehouseList.flatMap((wh) => wh.categories)),
  ].sort();
  const suppliersMap = new Map<string, string>();
  warehouseList.forEach((wh) => {
    if (wh.profiles?.company_name)
      suppliersMap.set(wh.supplier_id, wh.profiles.company_name);
  });
  const suppliers = [...suppliersMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({
    items,
    page: safePage,
    limit,
    total,
    totalPages,
    categories,
    suppliers,
  });
});

// Attested stock captured by any camera registered to this warehouse —
// this is the "attested image" a buyer is really asking to see: the
// warehouse photo plus the live camera attestations tied to it.
warehouseRouter.get("/:id/stock", async (req, res) => {
  const { data: cameras, error: camerasError } = await supabase
    .from("cameras")
    .select("id")
    .eq("warehouse_id", req.params.id);

  if (camerasError) {
    res.status(500).json({ error: "query_failed" });
    return;
  }

  const cameraIds = (cameras ?? []).map((c) => c.id as string);
  if (cameraIds.length === 0) {
    res.json([]);
    return;
  }

  const { data, error } = await supabase
    .from("attestations")
    .select(
      "id, camera_account, nonce, image_cid, image_hash, model, model_hash, items, captured_at",
    )
    .in("camera_id", cameraIds)
    .order("captured_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});
