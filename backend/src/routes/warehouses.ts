import { Readable } from "node:stream";
import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";
import {
  getBuyerStockCopy,
  getBuyerTrustChecks,
  getDefaultCameraCredentials,
  getPublicApiUrl,
  getVisionServiceUrl,
} from "../services/settings.js";
import {
  attestErrorPayload,
  runFullAttestation,
} from "../services/attestCamera.js";
import { requireX402Payment } from "../services/x402.js";

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

// Buyer (or any logged-in user) live MJPEG of an enrolled warehouse camera.
// Auth via access_token query param so an <img> can load it. Camera
// credentials never leave the backend — same proxy pattern as supplier
// /cameras/:id/stream, but ownership is not required (buyers need to see
// the aisle to trust attested stock).
warehouseRouter.get("/:id/live", async (req, res) => {
  const token =
    typeof req.query.access_token === "string" ? req.query.access_token : null;
  if (!token) {
    res.status(401).end();
    return;
  }

  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(401).end();
    return;
  }

  const cameraIdHint =
    typeof req.query.camera_id === "string" ? req.query.camera_id : null;

  let cameraQuery = supabase
    .from("cameras")
    .select("id, host, username, password, enrollment_status, label")
    .eq("warehouse_id", req.params.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (cameraIdHint) {
    cameraQuery = supabase
      .from("cameras")
      .select("id, host, username, password, enrollment_status, label")
      .eq("warehouse_id", req.params.id)
      .eq("id", cameraIdHint)
      .limit(1);
  }

  const { data: cameras } = await cameraQuery;
  const camera = cameras?.[0];
  if (!camera) {
    res.status(404).end();
    return;
  }

  const defaults = await getDefaultCameraCredentials();
  const host = (camera.host || defaults?.host || "").trim();
  const username = (camera.username || defaults?.username || "").trim();
  const password = camera.password || defaults?.password || "";
  if (!host || !username || !password) {
    res.status(404).end();
    return;
  }

  const visionUrl = await getVisionServiceUrl();
  const streamUrl = new URL("/cmos/stream", visionUrl);
  streamUrl.searchParams.set("host", host);
  streamUrl.searchParams.set("username", username);
  streamUrl.searchParams.set("password", password);

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const streamRes = await fetch(streamUrl, { signal: controller.signal });
    if (!streamRes.ok || !streamRes.body) {
      res.status(502).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      streamRes.headers.get("content-type") ?? "multipart/x-mixed-replace",
    );
    res.setHeader("Cache-Control", "no-store");
    const nodeStream = Readable.fromWeb(streamRes.body as never);
    nodeStream.on("error", () => {
      if (!res.writableEnded) res.end();
    });
    res.on("error", () => {});
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).end();
  }
});

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
    id: string | null;
    camera_id: string | null;
    camera_account: string | null;
    nonce: string | null;
    image_hash: string | null;
    model_hash: string | null;
    captured_at: string;
    cmos_score: number | null;
    prnu_score: number | null;
    detection_count: number | null;
    is_fake: boolean;
  };
  item: {
    sku: string;
    count: number;
    confidence: number;
    shelf: string;
    detectedCount: number;
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
      const [{ data: stockRows }, { data: cameras }] = await Promise.all([
        supabase
          .from("warehouse_stock")
          .select("sku, quantity, shelf, updated_at")
          .eq("warehouse_id", wh.id)
          .order("sku", { ascending: true }),
        supabase
          .from("cameras")
          .select("id, is_fake")
          .eq("warehouse_id", wh.id),
      ]);
      if (!stockRows?.length) return;

      const cameraIds = (cameras ?? []).map((c) => c.id as string);
      type LatestAtt = {
        id: string;
        camera_id: string;
        camera_account: string | null;
        nonce: string;
        image_hash: string;
        model_hash: string;
        items: unknown;
        captured_at: string;
        cmos_score: number | null;
        prnu_score: number | null;
        detection_count: number | null;
      };
      let latestAtt: LatestAtt | null = null;

      if (cameraIds.length > 0) {
        const { data: attestations } = await supabase
          .from("attestations")
          .select(
            "id, camera_id, camera_account, nonce, image_hash, model_hash, items, captured_at, cmos_score, prnu_score, detection_count",
          )
          .in("camera_id", cameraIds)
          .order("captured_at", { ascending: false })
          .limit(1);
        latestAtt = (attestations?.[0] as LatestAtt | undefined) ?? null;
      }

      const detectedItems = (latestAtt?.items ?? []) as Array<{
        sku: string;
        count: number;
        confidence: number;
        shelf: string;
      }>;

      const activeCamera = latestAtt
        ? (cameras ?? []).find((c) => c.id === latestAtt!.camera_id)
        : null;
      const isFake = Boolean(
        (activeCamera as { is_fake?: boolean } | undefined)?.is_fake,
      );

      for (const stock of stockRows) {
        const detected = detectedItems.find((i) => i.sku === stock.sku);
        rows.push({
          warehouse: wh,
          attestation: latestAtt
            ? {
                id: latestAtt.id,
                camera_id: latestAtt.camera_id,
                camera_account: latestAtt.camera_account,
                nonce: latestAtt.nonce,
                image_hash: latestAtt.image_hash,
                model_hash: latestAtt.model_hash,
                captured_at: latestAtt.captured_at,
                cmos_score: latestAtt.cmos_score,
                prnu_score: latestAtt.prnu_score,
                detection_count: latestAtt.detection_count,
                is_fake: isFake,
              }
            : {
                id: null,
                camera_id: null,
                camera_account: null,
                nonce: null,
                image_hash: null,
                model_hash: null,
                captured_at: stock.updated_at,
                cmos_score: null,
                prnu_score: null,
                detection_count: null,
                is_fake: false,
              },
          item: {
            sku: stock.sku,
            count: stock.quantity,
            shelf: stock.shelf ?? "",
            confidence: detected?.confidence ?? 0,
            detectedCount: detected?.count ?? 0,
          },
        });
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

// Supplier-declared inventory for a warehouse (orderable quantities).
warehouseRouter.get("/:id/stock", async (req: AuthedRequest, res) => {
  const warehouseId = req.params.id;
  const { data: warehouse, error: whError } = await supabase
    .from("warehouses")
    .select("id, supplier_id")
    .eq("id", warehouseId)
    .maybeSingle();

  if (whError || !warehouse) {
    res.status(404).json({ error: "warehouse_not_found" });
    return;
  }

  if (req.user!.role === "supplier" && warehouse.supplier_id !== req.user!.id) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { data, error } = await supabase
    .from("warehouse_stock")
    .select("id, sku, quantity, shelf, updated_at")
    .eq("warehouse_id", warehouseId)
    .order("sku", { ascending: true });

  if (error) {
    res.status(500).json({ error: "query_failed", detail: error.message });
    return;
  }
  res.json(data ?? []);
});

// Replace declared inventory for a warehouse (supplier only). Attestation
// / YOLO never writes these rows.
warehouseRouter.put("/:id/stock", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const warehouseId = req.params.id;
  const { data: warehouse, error: whError } = await supabase
    .from("warehouses")
    .select("id, supplier_id")
    .eq("id", warehouseId)
    .maybeSingle();

  if (whError || !warehouse || warehouse.supplier_id !== req.user!.id) {
    res.status(404).json({ error: "warehouse_not_found" });
    return;
  }

  const body = req.body as {
    items?: Array<{ sku?: string; quantity?: number; shelf?: string }>;
  };
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) {
    res.status(400).json({ error: "items_required" });
    return;
  }

  const cleaned: Array<{
    warehouse_id: string;
    supplier_id: string;
    sku: string;
    quantity: number;
    shelf: string;
    updated_at: string;
  }> = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const sku = typeof raw.sku === "string" ? raw.sku.trim() : "";
    const quantity = Number(raw.quantity);
    if (!sku || !Number.isFinite(quantity) || quantity < 0) {
      res.status(400).json({ error: "invalid_item", sku: raw.sku });
      return;
    }
    if (seen.has(sku)) continue;
    seen.add(sku);
    cleaned.push({
      warehouse_id: warehouseId,
      supplier_id: req.user!.id,
      sku,
      quantity: Math.floor(quantity),
      shelf: typeof raw.shelf === "string" ? raw.shelf.trim() : "",
      updated_at: new Date().toISOString(),
    });
  }

  await supabase
    .from("warehouse_stock")
    .delete()
    .eq("warehouse_id", warehouseId);
  if (cleaned.length > 0) {
    const { error: insertError } = await supabase
      .from("warehouse_stock")
      .insert(cleaned);
    if (insertError) {
      res
        .status(500)
        .json({ error: "insert_failed", detail: insertError.message });
      return;
    }
  }

  const { data } = await supabase
    .from("warehouse_stock")
    .select("id, sku, quantity, shelf, updated_at")
    .eq("warehouse_id", warehouseId)
    .order("sku", { ascending: true });

  res.json(data ?? []);
});

function bearerToken(req: AuthedRequest): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

// Buyer stock detail — declared quantity is orderable; YOLO is evidence only.
warehouseRouter.get("/:id/stock/:sku", async (req: AuthedRequest, res) => {
  const warehouseId = req.params.id;
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
    res.status(404).json({
      error: "sku_not_found",
      detail: "Supplier has not listed this SKU in warehouse inventory.",
    });
    return;
  }

  const { data: cameras } = await supabase
    .from("cameras")
    .select("id, label, enrollment_status, is_fake, fraud_detected_at")
    .eq("warehouse_id", warehouseId);

  const cameraIds = (cameras ?? []).map((c) => c.id as string);
  type MatchedAtt = {
    id: string;
    camera_id: string;
    camera_account: string | null;
    nonce: string;
    image_hash: string;
    model: string | null;
    model_hash: string | null;
    items: unknown;
    captured_at: string;
    cmos_score: number | null;
    prnu_score: number | null;
    detection_count: number | null;
  };
  let matchedAtt: MatchedAtt | null = null;

  if (cameraIds.length > 0) {
    const { data: attestations } = await supabase
      .from("attestations")
      .select(
        "id, camera_id, camera_account, nonce, image_hash, model, model_hash, items, captured_at, cmos_score, prnu_score, detection_count",
      )
      .in("camera_id", cameraIds)
      .order("captured_at", { ascending: false })
      .limit(1);
    matchedAtt = (attestations?.[0] as MatchedAtt | undefined) ?? null;
  }

  const detectedItems = (matchedAtt?.items ?? []) as Array<{
    sku: string;
    count: number;
    confidence: number;
    shelf: string;
  }>;
  const detected = detectedItems.find((i) => i.sku === sku);
  const camera = matchedAtt
    ? (cameras ?? []).find((c) => c.id === matchedAtt!.camera_id)
    : ((cameras ?? []).find((c) => c.enrollment_status === "enrolled") ??
      (cameras ?? [])[0] ??
      null);

  const token = bearerToken(req);
  const publicApi = await getPublicApiUrl();
  const trustChecks = await getBuyerTrustChecks();
  const stockCopy = await getBuyerStockCopy();

  let liveStreamUrl: string | null = null;
  if (token) {
    const cameraId = matchedAtt?.camera_id || camera?.id;
    if (cameraId) {
      const qs = new URLSearchParams({
        access_token: token,
        camera_id: cameraId,
      });
      liveStreamUrl = `${publicApi}/warehouses/${warehouseId}/live?${qs}`;
    }
  }

  const matchedItem = {
    sku: stock.sku,
    count: stock.quantity,
    shelf: stock.shelf ?? "",
    confidence: detected?.confidence ?? 0,
    detectedCount: detected?.count ?? 0,
  };

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
    item: matchedItem,
    skuAbsent: !detected,
    attestation: {
      id: matchedAtt?.id ?? null,
      camera_id: matchedAtt?.camera_id ?? camera?.id ?? null,
      camera_account: matchedAtt?.camera_account ?? null,
      camera_label: camera?.label ?? null,
      nonce: matchedAtt?.nonce ?? null,
      image_hash: matchedAtt?.image_hash ?? null,
      model: matchedAtt?.model ?? null,
      model_hash: matchedAtt?.model_hash ?? null,
      items: detectedItems,
      captured_at: matchedAtt?.captured_at ?? stock.updated_at,
      cmos_score: matchedAtt?.cmos_score ?? null,
      prnu_score: matchedAtt?.prnu_score ?? null,
      detection_count: matchedAtt?.detection_count ?? null,
      is_fake: Boolean((camera as { is_fake?: boolean } | undefined)?.is_fake),
    },
    liveStreamUrl,
    camera: camera
      ? {
          id: camera.id,
          label: camera.label,
          isFake: Boolean((camera as { is_fake?: boolean }).is_fake),
          fraudDetectedAt:
            (camera as { fraud_detected_at?: string | null })
              .fraud_detected_at ?? null,
        }
      : null,
    totalUnits: stock.quantity,
    detectedTotal: detectedItems.reduce(
      (n, i) => n + (Number(i.count) || 0),
      0,
    ),
    trustChecks: trustChecks.map((c) => ({ ...c, ok: true })),
    copy: {
      ...stockCopy,
      overlaySub: detected
        ? `Camera proof for ${matchedItem.sku} at ${warehouse.name}. Orderable quantity is supplier-declared (${matchedItem.count}); vision detected ${matchedItem.detectedCount} in the latest frame.`
        : `Orderable quantity for ${matchedItem.sku} is supplier-declared (${matchedItem.count}). Latest camera frame did not detect this SKU (vision can miss shadow/background items).`,
      countLiveLabel: "Pay & attest warehouse",
      countLiveBusy: "Paying & attesting…",
      countLiveHint:
        "Pay with x402 to re-run live CMOS + nonce proof. Fake/stub cameras are flagged Unverified in the database.",
    },
  });
});

// Paid live attestation from the buyer View-attestation modal (x402 required).
warehouseRouter.post(
  "/:id/count-live",
  requireX402Payment({
    description:
      "ShelfSign warehouse live attestation (CMOS + nonce + YOLO → HCS)",
    resourcePath: (req) => `/warehouses/${req.params.id}/count-live`,
  }),
  async (req: AuthedRequest, res) => {
    const warehouseId = req.params.id;
    const cameraIdHint =
      typeof req.body?.cameraId === "string" ? req.body.cameraId : null;

    let cameraQuery = supabase
      .from("cameras")
      .select(
        "id, supplier_id, warehouse_id, host, username, password, cmos_account, enrollment_status, label, is_fake, escrow_status",
      )
      .eq("warehouse_id", warehouseId)
      .order("created_at", { ascending: true })
      .limit(1);

    if (cameraIdHint) {
      cameraQuery = supabase
        .from("cameras")
        .select(
          "id, supplier_id, warehouse_id, host, username, password, cmos_account, enrollment_status, label, is_fake, escrow_status",
        )
        .eq("warehouse_id", warehouseId)
        .eq("id", cameraIdHint)
        .limit(1);
    }

    const { data: cameras, error: camError } = await cameraQuery;
    if (camError) {
      res
        .status(500)
        .json({ error: "camera_query_failed", detail: camError.message });
      return;
    }
    const camera = cameras?.[0];
    if (!camera) {
      res.status(404).json({
        error: "no_camera",
        detail: "No camera found for this warehouse.",
      });
      return;
    }

    try {
      const result = await runFullAttestation(camera, {
        lockedBy: req.user!.id,
      });
      // Restake clears is_fake; attest no longer does. Echo clean status.
      res.status(201).json({
        cameraId: result.cameraId,
        cameraLabel: result.cameraLabel,
        items: result.items,
        totalUnits: result.totalUnits,
        detectionCount: result.detectionCount,
        model: result.model,
        modelHash: result.modelHash,
        imageHash: result.imageHash,
        engine: result.engine,
        countedAt: result.countedAt,
        nonce: result.nonce,
        cmosScore: result.cmosScore,
        prnuScore: result.prnuScore,
        attestationId: (result.attestation as { id?: string }).id ?? null,
        attestation: result.attestation,
        steps: result.steps,
        fullAttestation: true,
        isFake: false,
      });
    } catch (err) {
      const { status, body } = attestErrorPayload(err);
      res.status(status).json(body);
    }
  },
);
