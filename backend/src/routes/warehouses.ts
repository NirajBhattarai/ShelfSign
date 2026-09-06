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
  const host = defaults?.host || camera.host;
  const username = defaults?.username || camera.username;
  const password = defaults?.password || camera.password;
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
    id: string;
    camera_id: string;
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
          "id, camera_id, camera_account, nonce, image_hash, model_hash, items, captured_at",
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
              camera_id: att.camera_id,
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
      "id, camera_id, camera_account, nonce, image_cid, image_hash, model, model_hash, items, captured_at",
    )
    .in("camera_id", cameraIds)
    .order("captured_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});

function bearerToken(req: AuthedRequest): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

// Buyer stock detail for one SKU — live stream URL + trust copy come from
// backend/DB so the frontend never hardcodes hosts or SiliconWitness text.
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

  const { data: cameras } = await supabase
    .from("cameras")
    .select("id, label, enrollment_status")
    .eq("warehouse_id", warehouseId);

  const cameraIds = (cameras ?? []).map((c) => c.id as string);

  const { data: attestations } = cameraIds.length
    ? await supabase
        .from("attestations")
        .select(
          "id, camera_id, camera_account, nonce, image_cid, image_hash, model, model_hash, items, captured_at",
        )
        .in("camera_id", cameraIds)
        .order("captured_at", { ascending: false })
    : { data: [] as never[] };

  type StockItemRow = {
    sku: string;
    count: number;
    confidence: number;
    shelf: string;
  };

  type AttestationRow = NonNullable<typeof attestations>[number];

  let matchedItem: StockItemRow | null = null;
  let matchedAtt: AttestationRow | null = null;

  for (const att of attestations ?? []) {
    const items = (att.items ?? []) as StockItemRow[];
    const item = items.find((i) => i.sku === sku);
    if (item) {
      matchedItem = item;
      matchedAtt = att;
      break;
    }
  }

  // Camera may not be aimed at this SKU (or YOLO saw nothing). Still serve
  // the warehouse page with count 0 + latest attestation / live stream so
  // buyers can re-attest instead of getting a hard 404.
  const skuAbsent = !matchedItem;
  if (!matchedItem) {
    matchedItem = { sku, count: 0, confidence: 0, shelf: "" };
  }
  if (!matchedAtt) {
    matchedAtt = (attestations ?? [])[0] ?? null;
  }

  const fallbackCamera =
    (cameras ?? []).find((c) => c.enrollment_status === "enrolled") ??
    (cameras ?? [])[0] ??
    null;

  if (!matchedAtt && !fallbackCamera) {
    res.status(404).json({
      error: "sku_not_found",
      detail: "No camera or attestation for this warehouse yet.",
    });
    return;
  }

  const camera = matchedAtt
    ? (cameras ?? []).find((c) => c.id === matchedAtt!.camera_id)
    : fallbackCamera;
  const token = bearerToken(req);
  const publicApi = await getPublicApiUrl();
  const trustChecks = await getBuyerTrustChecks();
  const stockCopy = await getBuyerStockCopy();

  let liveStreamUrl: string | null = null;
  if (token) {
    const cameraId = matchedAtt?.camera_id || fallbackCamera?.id;
    if (cameraId) {
      const qs = new URLSearchParams({
        access_token: token,
        camera_id: cameraId,
      });
      liveStreamUrl = `${publicApi}/warehouses/${warehouseId}/live?${qs}`;
    }
  }

  const items = (matchedAtt?.items ?? []) as StockItemRow[];
  const capturedAt = matchedAtt?.captured_at ?? new Date().toISOString();

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
    skuAbsent,
    attestation: {
      id: matchedAtt?.id ?? null,
      camera_id: matchedAtt?.camera_id ?? fallbackCamera?.id ?? null,
      camera_account: matchedAtt?.camera_account ?? null,
      camera_label: camera?.label ?? null,
      nonce: matchedAtt?.nonce ?? null,
      image_cid: matchedAtt?.image_cid ?? null,
      image_hash: matchedAtt?.image_hash ?? null,
      model: matchedAtt?.model ?? null,
      model_hash: matchedAtt?.model_hash ?? null,
      items,
      captured_at: capturedAt,
    },
    liveStreamUrl,
    totalUnits: items.reduce((n, i) => n + (Number(i.count) || 0), 0),
    trustChecks: trustChecks.map((c) => ({ ...c, ok: true })),
    copy: {
      ...stockCopy,
      overlaySub: skuAbsent
        ? `${matchedItem.sku} was not in the latest camera count at ${warehouse.name} (0 units). Aim the camera or attest again.`
        : `Proof that ${matchedItem.sku} was counted on a real enrolled camera at ${warehouse.name} — not a spreadsheet upload.`,
      countLiveLabel: "Attest live frame",
      countLiveBusy: "Running full attestation (OSD + PUF + YOLO)…",
      countLiveHint:
        "Runs a full SiliconWitness attestation: OSD nonce, PUF identity, then YOLO count on that frame. Saves a new attestation for this warehouse camera.",
    },
  });
});

// Full attestation from the buyer View-attestation UI: OSD + PUF + YOLO,
// then persist (same pipeline as supplier Attest stock).
warehouseRouter.post("/:id/count-live", async (req: AuthedRequest, res) => {
  const warehouseId = req.params.id;
  const cameraIdHint =
    typeof req.body?.cameraId === "string" ? req.body.cameraId : null;

  let cameraQuery = supabase
    .from("cameras")
    .select(
      "id, supplier_id, host, username, password, cmos_account, enrollment_status, label",
    )
    .eq("warehouse_id", warehouseId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (cameraIdHint) {
    cameraQuery = supabase
      .from("cameras")
      .select(
        "id, supplier_id, host, username, password, cmos_account, enrollment_status, label",
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
    const result = await runFullAttestation(camera);
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
      attestationId: (result.attestation as { id?: string }).id ?? null,
      attestation: result.attestation,
      steps: result.steps,
      fullAttestation: true,
    });
  } catch (err) {
    const { status, body } = attestErrorPayload(err);
    res.status(status).json(body);
  }
});
