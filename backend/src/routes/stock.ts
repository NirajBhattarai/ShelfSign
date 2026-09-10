import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";
import { fetchRecentHcsMessages } from "../services/chain.js";

export const stockRouter = Router();

stockRouter.use(requireAuth);

/** Recent HCS topic messages (attestation + payment receipts). */
stockRouter.get("/hcs/recent", async (_req, res) => {
  try {
    const data = await fetchRecentHcsMessages(25);
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: "hcs_mirror_failed",
      detail: err instanceof Error ? err.message : "unknown",
    });
  }
});

/**
 * Free attested stock query — buyers can view the latest camera proof
 * without x402. Live re-attest is paid via POST /warehouses/:id/count-live.
 */
stockRouter.get("/:warehouseId/:sku", async (req: AuthedRequest, res) => {
  const warehouseId = req.params.warehouseId;
  const sku = decodeURIComponent(req.params.sku);

  const { data: warehouse, error: whError } = await supabase
    .from("warehouses")
    .select(
      "id, name, location, categories, image_url, supplier_id, profiles(company_name)",
    )
    .eq("id", warehouseId)
    .maybeSingle();

  if (whError || !warehouse) {
    res.status(404).json({ error: "warehouse_not_found" });
    return;
  }

  const { data: stock } = await supabase
    .from("warehouse_stock")
    .select("sku, quantity, shelf, updated_at")
    .eq("warehouse_id", warehouseId)
    .eq("sku", sku)
    .maybeSingle();

  if (!stock) {
    res.status(404).json({ error: "sku_not_found" });
    return;
  }

  const { data: cameras } = await supabase
    .from("cameras")
    .select("id, label")
    .eq("warehouse_id", warehouseId);
  const cameraIds = (cameras ?? []).map((c) => c.id as string);

  let attestation: Record<string, unknown> | null = null;
  if (cameraIds.length > 0) {
    const { data: rows } = await supabase
      .from("attestations")
      .select(
        "id, camera_id, camera_account, nonce, image_hash, model, model_hash, items, captured_at, cmos_score, detection_count, hcs_topic_id, hcs_sequence_number, hcs_transaction_id",
      )
      .in("camera_id", cameraIds)
      .order("captured_at", { ascending: false })
      .limit(1);
    attestation = (rows?.[0] as Record<string, unknown>) ?? null;
  }

  const detectedItems = (attestation?.items ?? []) as Array<{
    sku: string;
    count: number;
    confidence: number;
    shelf: string;
  }>;
  const detected = detectedItems.find((i) => i.sku === sku);

  res.json({
    warehouse: {
      id: warehouse.id,
      name: warehouse.name,
      location: warehouse.location,
      categories: warehouse.categories ?? [],
      image_url: warehouse.image_url,
      supplier_id: warehouse.supplier_id,
      profiles: warehouse.profiles,
    },
    item: {
      sku: stock.sku,
      count: stock.quantity,
      shelf: stock.shelf ?? "",
      detectedCount: detected?.count ?? 0,
      confidence: detected?.confidence ?? 0,
    },
    attestation,
  });
});
