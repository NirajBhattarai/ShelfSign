import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";
import {
  requireX402Payment,
  type PaidRequest,
  x402MockMode,
  buildPaymentRequirements,
} from "../services/x402.js";
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

/** Challenge preview (no settle). */
stockRouter.get("/:warehouseId/:sku/challenge", async (req, res) => {
  const resource = `/stock/${req.params.warehouseId}/${encodeURIComponent(req.params.sku)}`;
  const requirements = await buildPaymentRequirements(
    resource,
    "ShelfSign attested stock query",
  );
  res.json({
    x402Version: 2,
    accepts: [requirements],
    resource,
    mock: x402MockMode(),
  });
});

/**
 * x402-paywalled attested stock query.
 * Returns 402 + accepts[] unless PAYMENT-SIGNATURE (or mock) is present.
 */
stockRouter.get(
  "/:warehouseId/:sku",
  requireX402Payment({
    description: "ShelfSign attested stock query (declared qty + camera proof)",
    resourcePath: (req) =>
      `/stock/${req.params.warehouseId}/${encodeURIComponent(req.params.sku)}`,
  }),
  async (req: PaidRequest, res) => {
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
      paid: true,
      x402: {
        mock: req.x402?.settlement.mock ?? x402MockMode(),
        amount: req.x402?.requirements.amount,
        asset: req.x402?.requirements.asset,
        network: req.x402?.requirements.network,
        payer: req.x402?.settlement.payer ?? null,
        settlementTx: req.x402?.settlement.transaction ?? null,
        hcs: req.x402?.hcs
          ? {
              topicId: req.x402.hcs.topicId,
              sequenceNumber: req.x402.hcs.sequenceNumber,
              transactionId: req.x402.hcs.transactionId,
              hashscanUrl: req.x402.hcs.hashscanUrl,
            }
          : null,
      },
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
  },
);
