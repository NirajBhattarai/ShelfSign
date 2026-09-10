import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";

export const orderRouter = Router();

orderRouter.use(requireAuth);

interface CreateOrderBody {
  supplierId: string;
  sku: string;
  quantity: number;
  attestationId?: string;
}

type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled";

// Only forward progress or cancellation — never backward, and nothing
// changes once an order is fulfilled or cancelled.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

interface RawOrder {
  id: string;
  buyer_id: string;
  supplier_id: string;
  sku: string;
  quantity: number;
  attestation_id: string | null;
  status: OrderStatus;
  created_at: string;
}

// Enriches raw order rows with the buyer's real company name and the
// warehouse the order's attestation (if any) was captured in — both
// derived from real relations (profiles, attestations -> cameras ->
// warehouses), not fabricated. attestation_id is optional on an order, so
// warehouse comes back null when there isn't one to trace.
async function enrichOrders(orders: RawOrder[]) {
  if (orders.length === 0) return [];

  const buyerIds = [...new Set(orders.map((o) => o.buyer_id))];
  const supplierIds = [...new Set(orders.map((o) => o.supplier_id))];
  const attestationIds = [
    ...new Set(
      orders.map((o) => o.attestation_id).filter((id): id is string => !!id),
    ),
  ];

  const [{ data: buyers }, { data: suppliers }, { data: attestations }] =
    await Promise.all([
      supabase.from("profiles").select("id, company_name").in("id", buyerIds),
      supabase
        .from("profiles")
        .select("id, company_name")
        .in("id", supplierIds),
      attestationIds.length
        ? supabase
            .from("attestations")
            .select("id, camera_id")
            .in("id", attestationIds)
        : Promise.resolve({ data: [] as { id: string; camera_id: string }[] }),
    ]);

  const cameraIds = [...new Set((attestations ?? []).map((a) => a.camera_id))];
  const { data: cameras } = cameraIds.length
    ? await supabase
        .from("cameras")
        .select("id, warehouse_id")
        .in("id", cameraIds)
    : { data: [] as { id: string; warehouse_id: string }[] };

  const warehouseIds = [...new Set((cameras ?? []).map((c) => c.warehouse_id))];
  const { data: warehouses } = warehouseIds.length
    ? await supabase
        .from("warehouses")
        .select("id, name")
        .in("id", warehouseIds)
    : { data: [] as { id: string; name: string }[] };

  const buyerNameById = new Map(
    (buyers ?? []).map((b) => [b.id, b.company_name]),
  );
  const supplierNameById = new Map(
    (suppliers ?? []).map((s) => [s.id, s.company_name]),
  );
  const cameraIdByAttestationId = new Map(
    (attestations ?? []).map((a) => [a.id, a.camera_id]),
  );
  const warehouseIdByCameraId = new Map(
    (cameras ?? []).map((c) => [c.id, c.warehouse_id]),
  );
  const warehouseNameById = new Map(
    (warehouses ?? []).map((w) => [w.id, w.name]),
  );

  return orders.map((o) => {
    const cameraId = o.attestation_id
      ? cameraIdByAttestationId.get(o.attestation_id)
      : undefined;
    const warehouseId = cameraId
      ? warehouseIdByCameraId.get(cameraId)
      : undefined;
    return {
      ...o,
      buyer_company_name: buyerNameById.get(o.buyer_id) ?? null,
      supplier_company_name: supplierNameById.get(o.supplier_id) ?? null,
      warehouse_name: warehouseId
        ? (warehouseNameById.get(warehouseId) ?? null)
        : null,
    };
  });
}

orderRouter.post("/", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "buyer") {
    res.status(403).json({ error: "buyer_only" });
    return;
  }

  const { supplierId, sku, quantity, attestationId, warehouseId } = (req.body ??
    {}) as Partial<CreateOrderBody> & { warehouseId?: string };
  if (!supplierId || !sku || !quantity || quantity < 1) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  let stockQuery = supabase
    .from("warehouse_stock")
    .select("quantity, warehouse_id")
    .eq("supplier_id", supplierId)
    .eq("sku", sku);
  if (warehouseId) {
    stockQuery = stockQuery.eq("warehouse_id", warehouseId);
  }
  const { data: stockRows, error: stockError } = await stockQuery;
  if (stockError) {
    res
      .status(500)
      .json({ error: "stock_query_failed", detail: stockError.message });
    return;
  }
  const available = (stockRows ?? []).reduce(
    (n, row) => n + (Number(row.quantity) || 0),
    0,
  );
  if (available < 1) {
    res.status(409).json({
      error: "out_of_stock",
      detail: "Supplier has not listed available quantity for this SKU.",
    });
    return;
  }
  if (quantity > available) {
    res.status(409).json({
      error: "insufficient_stock",
      detail: `Only ${available} units available.`,
      available,
    });
    return;
  }

  const { data, error } = await supabase
    .from("buy_orders")
    .insert({
      buyer_id: req.user!.id,
      supplier_id: supplierId,
      sku,
      quantity,
      attestation_id: attestationId ?? null,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: "insert_failed", details: error.message });
    return;
  }
  res.status(201).json(data);
});

orderRouter.get("/mine", async (req: AuthedRequest, res) => {
  const { data, error } = await supabase
    .from("buy_orders")
    .select("*")
    .eq("buyer_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(await enrichOrders(data as RawOrder[]));
});

orderRouter.get("/incoming", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const { data, error } = await supabase
    .from("buy_orders")
    .select("*")
    .eq("supplier_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(await enrichOrders(data as RawOrder[]));
});

// Single order detail — either party to the order can fetch it.
orderRouter.get("/:id", async (req: AuthedRequest, res) => {
  const { data, error } = await supabase
    .from("buy_orders")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  if (
    !data ||
    (data.buyer_id !== req.user!.id && data.supplier_id !== req.user!.id)
  ) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const [enriched] = await enrichOrders([data as RawOrder]);
  res.json(enriched);
});

// Supplier-only status transition — the actual "receive an order" action.
// Only forward-progress or cancellation is allowed (see ALLOWED_TRANSITIONS);
// anything else is rejected with the current status so the UI can explain why.
orderRouter.patch("/:id/status", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const nextStatus = (req.body ?? {}).status as OrderStatus | undefined;
  if (!nextStatus || !(nextStatus in ALLOWED_TRANSITIONS)) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }

  const { data: order, error: fetchError } = await supabase
    .from("buy_orders")
    .select("id, supplier_id, status")
    .eq("id", req.params.id)
    .maybeSingle();

  if (fetchError || !order || order.supplier_id !== req.user!.id) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[order.status as OrderStatus];
  if (!allowed.includes(nextStatus)) {
    res
      .status(409)
      .json({ error: "invalid_transition", currentStatus: order.status });
    return;
  }

  const { data: updated, error: updateError } = await supabase
    .from("buy_orders")
    .update({ status: nextStatus })
    .eq("id", req.params.id)
    .select()
    .single();

  if (updateError || !updated) {
    res.status(500).json({ error: "update_failed" });
    return;
  }

  const [enriched] = await enrichOrders([updated as RawOrder]);
  res.json(enriched);
});
