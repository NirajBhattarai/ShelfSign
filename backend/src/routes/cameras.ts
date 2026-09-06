import { Readable } from "node:stream";
import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";

export const cameraRouter = Router();
const VISION_SERVICE_URL =
  process.env.VISION_SERVICE_URL ?? "http://localhost:8000";

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

  const streamUrl = new URL("/cmos/stream", VISION_SERVICE_URL);
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

interface RegisterCameraBody {
  warehouseId: string;
  label: string;
  host: string;
  username: string;
  password: string;
}

// Registers a camera under one of the supplier's existing warehouses
// (a warehouse — with its categories and photo — must be created first),
// then kicks off real CMOS/PUF enrollment via vision-service against the
// camera's own ISAPI connection details. Enrollment result determines the
// camera's status — never left "pending" silently.
cameraRouter.post("/", async (req: AuthedRequest, res) => {
  if (req.user!.role !== "supplier") {
    res.status(403).json({ error: "supplier_only" });
    return;
  }

  const { warehouseId, label, host, username, password } = (req.body ??
    {}) as Partial<RegisterCameraBody>;
  if (
    !warehouseId ||
    !label?.trim() ||
    !host?.trim() ||
    !username?.trim() ||
    !password
  ) {
    res.status(400).json({ error: "missing_fields" });
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
      host: host.trim(),
      username: username.trim(),
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

  try {
    const enrollRes = await fetch(`${VISION_SERVICE_URL}/cmos/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cameraId: camera.id, host, username, password }),
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
      "id, warehouse_id, supplier_id, label, host, enrollment_status, cmos_account, created_at, warehouses(name, location)",
    )
    .eq("supplier_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});
