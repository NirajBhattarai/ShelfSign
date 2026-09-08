import { Readable } from "node:stream";
import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";
import {
  getDefaultCameraCredentials,
  getPublicApiUrl,
  getVisionServiceUrl,
} from "../services/settings.js";
import {
  attestErrorPayload,
  runFullAttestation,
} from "../services/attestCamera.js";

export const cameraRouter = Router();

// Near-live camera view for the supplier dashboard: an <img> tag can't set
// an Authorization header, so this route authenticates via a query-param
// access_token instead — registered before cameraRouter.use(requireAuth)
// below so that header-based middleware doesn't reject it first. The
// camera's own host/username/password never leave the backend; this just
// proxies vision-service's MJPEG relay of the same ISAPI snapshot endpoint
// enrollment already uses.
cameraRouter.get("/:id/stream", async (req, res) => {
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

  const { data: camera } = await supabase
    .from("cameras")
    .select("host, username, password, supplier_id")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!camera || camera.supplier_id !== userData.user.id) {
    res.status(404).end();
    return;
  }

  const visionUrl = await getVisionServiceUrl();
  const streamUrl = new URL("/cmos/stream", visionUrl);
  streamUrl.searchParams.set("host", camera.host);
  streamUrl.searchParams.set("username", camera.username);
  streamUrl.searchParams.set("password", camera.password);

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
    const nodeStream = Readable.fromWeb(streamRes.body as never);
    // Closing the "View live" overlay aborts `controller`, which surfaces
    // here as an 'error' event (AbortError) on the piped stream — expected,
    // not a real failure. Without this listener Node treats it as an
    // unhandled error and crashes the whole process (this took the backend
    // down entirely the first time, breaking every other route).
    nodeStream.on("error", () => {
      if (!res.writableEnded) res.end();
    });
    res.on("error", () => {});
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).end();
  }
});

cameraRouter.use(requireAuth);

function bearerToken(req: AuthedRequest): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/** Returns a ready-to-use MJPEG URL (built from DB public_api_url). Frontend
 *  must not assemble stream hosts itself. */
cameraRouter.get("/:id/stream-url", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  const { data: camera } = await supabase
    .from("cameras")
    .select("id, supplier_id")
    .eq("id", req.params.id)
    .eq("supplier_id", req.user!.id)
    .maybeSingle();

  if (!camera) {
    res.status(404).json({ error: "camera_not_found" });
    return;
  }

  const publicApi = await getPublicApiUrl();
  const qs = new URLSearchParams({ access_token: token });
  res.json({
    url: `${publicApi}/cameras/${camera.id}/stream?${qs}`,
  });
});

interface RegisterCameraBody {
  warehouseId: string;
  label: string;
  /** Optional — for now defaults come from system_settings (SiliconWitness). */
  host?: string;
  username?: string;
  password?: string;
}

// Registers a camera under one of the supplier's existing warehouses,
// then kicks off real CMOS/PUF enrollment via vision-service (SiliconWitness
// pipeline). Connection details come from the DB (`system_settings`) by
// default so the frontend never hardcodes or collects camera credentials.
cameraRouter.post("/", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const body = (req.body ?? {}) as Partial<RegisterCameraBody>;
  const { warehouseId, label } = body;
  if (!warehouseId || !label?.trim()) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  const defaults = await getDefaultCameraCredentials();
  const host = (body.host?.trim() || defaults?.host || "").trim();
  const username = (body.username?.trim() || defaults?.username || "").trim();
  const password = body.password || defaults?.password || "";

  if (!host || !username || !password) {
    res.status(503).json({
      error: "camera_defaults_not_configured",
      detail:
        "Seed Hikvision credentials into system_settings (npm run seed:camera-settings).",
    });
    return;
  }

  const { data: warehouse } = await supabase
    .from("warehouses")
    .select("id")
    .eq("id", warehouseId)
    .eq("supplier_id", req.user!.id)
    .maybeSingle();

  if (!warehouse) {
    res.status(404).json({ error: "warehouse_not_found" });
    return;
  }

  const { data: camera, error: cameraError } = await supabase
    .from("cameras")
    .insert({
      warehouse_id: warehouseId,
      supplier_id: req.user!.id,
      label: label.trim(),
      host,
      username,
      password,
      enrollment_status: "pending",
    })
    .select(
      "id, warehouse_id, supplier_id, label, host, enrollment_status, cmos_account, created_at",
    )
    .single();

  if (cameraError || !camera) {
    res.status(500).json({ error: "camera_create_failed" });
    return;
  }

  const visionUrl = await getVisionServiceUrl();
  try {
    const enrollRes = await fetch(`${visionUrl}/cmos/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cameraId: camera.id,
        host,
        username,
        password,
      }),
    });

    if (enrollRes.ok) {
      const { cmosAccount } = (await enrollRes.json()) as {
        cmosAccount: string;
      };
      const { data: enrolled } = await supabase
        .from("cameras")
        .update({ enrollment_status: "enrolled", cmos_account: cmosAccount })
        .eq("id", camera.id)
        .select(
          "id, warehouse_id, supplier_id, label, host, enrollment_status, cmos_account, created_at",
        )
        .single();
      res.status(201).json(enrolled ?? camera);
      return;
    }

    await supabase
      .from("cameras")
      .update({ enrollment_status: "failed" })
      .eq("id", camera.id);
    res.status(201).json({ ...camera, enrollment_status: "failed" });
  } catch {
    await supabase
      .from("cameras")
      .update({ enrollment_status: "failed" })
      .eq("id", camera.id);
    res.status(201).json({ ...camera, enrollment_status: "failed" });
  }
});

cameraRouter.get("/", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const { data, error } = await supabase
    .from("cameras")
    .select(
      "id, warehouse_id, supplier_id, label, host, enrollment_status, cmos_account, is_fake, fraud_detected_at, attest_locked_at, attest_locked_by, created_at, warehouses(name, location)",
    )
    .eq("supplier_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});

interface AttestBody {
  nonce?: string;
}

// SiliconWitness challenge-response → YOLO stock count → verified attestation.
cameraRouter.post("/:id/attest", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const { data: camera } = await supabase
    .from("cameras")
    .select(
      "id, supplier_id, warehouse_id, label, host, username, password, cmos_account, enrollment_status, is_fake",
    )
    .eq("id", req.params.id)
    .eq("supplier_id", req.user!.id)
    .maybeSingle();

  if (!camera) {
    res.status(404).json({ error: "camera_not_found" });
    return;
  }

  const body = (req.body ?? {}) as AttestBody;
  try {
    const result = await runFullAttestation(camera, {
      nonce: body.nonce,
      lockedBy: req.user!.id,
    });
    res.status(201).json({
      attestation: result.attestation,
      steps: result.steps,
    });
  } catch (err) {
    const { status, body: payload } = attestErrorPayload(err);
    res.status(status).json(payload);
  }
});
