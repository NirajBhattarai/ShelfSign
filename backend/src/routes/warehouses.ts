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
