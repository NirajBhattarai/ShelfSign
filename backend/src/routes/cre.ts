import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { supabase } from "../services/supabase.js";
import {
  scoreAttestationRisk,
  type AttestationRiskPayload,
} from "../services/creRisk.js";

export const creRouter = Router();

function creApiToken(): string {
  return process.env.CRE_API_TOKEN?.trim() ?? "";
}

function bearerOk(req: Request): boolean {
  const expected = creApiToken();
  if (!expected) return false;
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const got = Buffer.from(match[1]);
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

function requireCreBearer(req: Request, res: Response, next: NextFunction) {
  if (!creApiToken()) {
    res.status(503).json({ error: "cre_token_not_configured" });
    return;
  }
  if (!bearerOk(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

async function buildRiskPayload(
  reviewId: string,
  attestationId: string,
): Promise<AttestationRiskPayload | null> {
  const { data: attestation, error: attErr } = await supabase
    .from("attestations")
    .select(
      "id, camera_id, camera_account, image_hash, captured_at, hcs_topic_id, hcs_sequence_number",
    )
    .eq("id", attestationId)
    .single();

  if (attErr || !attestation) return null;

  const { data: camera, error: camErr } = await supabase
    .from("cameras")
    .select(
      "id, label, host, cmos_account, enrollment_status, is_fake, fraud_detected_at",
    )
    .eq("id", attestation.camera_id)
    .single();

  if (camErr || !camera) return null;

  return {
    reviewId,
    attestationId: attestation.id,
    cameraId: camera.id,
    cameraHost: (camera as { host?: string }).host ?? "",
    cameraLabel: camera.label ?? null,
    enrollmentStatus: camera.enrollment_status,
    isFake: Boolean(camera.is_fake),
    fraudDetectedAt:
      (camera as { fraud_detected_at?: string | null }).fraud_detected_at ??
      null,
    cmosAccount: camera.cmos_account ?? attestation.camera_account ?? null,
    attestation: {
      id: attestation.id,
      capturedAt: attestation.captured_at,
      imageHash: attestation.image_hash,
      hcsTopicId: attestation.hcs_topic_id ?? null,
      hcsSequenceNumber: attestation.hcs_sequence_number ?? null,
    },
  };
}

/** Public: queue a confidential CRE review for an attestation. */
creRouter.post("/reviews", async (req, res) => {
  const attestationId = String(req.body?.attestationId ?? "").trim();
  if (!attestationId) {
    res.status(400).json({ error: "missing_attestation_id" });
    return;
  }

  const { data: attestation, error } = await supabase
    .from("attestations")
    .select("id, camera_id")
    .eq("id", attestationId)
    .single();

  if (error || !attestation) {
    res.status(404).json({ error: "attestation_not_found" });
    return;
  }

  const { data: existing } = await supabase
    .from("cre_reviews")
    .select("id, status")
    .eq("attestation_id", attestationId)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    res.json({ reviewId: existing.id, status: existing.status, queued: false });
    return;
  }

  const { data: review, error: insertErr } = await supabase
    .from("cre_reviews")
    .insert({
      attestation_id: attestation.id,
      camera_id: attestation.camera_id,
      status: "pending",
      requested_by: String(req.body?.requestedBy ?? "buyer").slice(0, 64),
    })
    .select("id, status")
    .single();

  if (insertErr || !review) {
    res.status(500).json({ error: "review_create_failed", detail: insertErr });
    return;
  }

  res.status(201).json({
    reviewId: review.id,
    status: review.status,
    queued: true,
  });
});

/** Public: latest public verdict for an attestation (no sensitive fields). */
creRouter.get("/verdicts/:attestationId", async (req, res) => {
  const attestationId = String(req.params.attestationId ?? "").trim();
  const { data, error } = await supabase
    .from("cre_verdicts")
    .select(
      "id, attestation_id, camera_id, verdict, score, reason_hash, source, created_at",
    )
    .eq("attestation_id", attestationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: "verdict_lookup_failed" });
    return;
  }

  res.json({ verdict: data ?? null });
});

/**
 * CRE TEE only: claim next pending review + sensitive risk payload.
 * Auth: Bearer CRE_API_TOKEN (Vault DON secret inside the enclave).
 */
creRouter.get("/internal/pending-risk", requireCreBearer, async (_req, res) => {
  const { data: review, error } = await supabase
    .from("cre_reviews")
    .select("id, attestation_id, camera_id, status")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: "pending_lookup_failed" });
    return;
  }

  if (!review) {
    res.json({ pending: false });
    return;
  }

  await supabase
    .from("cre_reviews")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", review.id)
    .eq("status", "pending");

  const risk = await buildRiskPayload(review.id, review.attestation_id);
  if (!risk) {
    await supabase
      .from("cre_reviews")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", review.id);
    res.status(404).json({ error: "risk_payload_unavailable" });
    return;
  }

  res.json({
    pending: true,
    slashThreshold: Number(process.env.CRE_SLASH_THRESHOLD ?? "700"),
    holdThreshold: Number(process.env.CRE_HOLD_THRESHOLD ?? "350"),
    risk,
  });
});

/**
 * CRE TEE / DON callback: store public verdict only.
 * Auth: Bearer CRE_API_TOKEN.
 */
creRouter.post("/internal/verdicts", requireCreBearer, async (req, res) => {
  const body = req.body as {
    reviewId?: string;
    attestationId?: string;
    cameraId?: string;
    verdict?: string;
    score?: number;
    reasonHash?: string;
    source?: string;
  };

  const reviewId = String(body.reviewId ?? "").trim();
  const attestationId = String(body.attestationId ?? "").trim();
  const cameraId = String(body.cameraId ?? "").trim();
  const verdict = String(body.verdict ?? "")
    .trim()
    .toUpperCase();
  const score = Number(body.score);
  const reasonHash = String(body.reasonHash ?? "").trim();
  const source = String(body.source ?? "cre").trim();

  if (
    !reviewId ||
    !attestationId ||
    !cameraId ||
    !["CLEAR", "HOLD", "SLASH"].includes(verdict) ||
    !Number.isFinite(score) ||
    !reasonHash
  ) {
    res.status(400).json({ error: "invalid_verdict_body" });
    return;
  }

  const { data: row, error } = await supabase
    .from("cre_verdicts")
    .insert({
      review_id: reviewId,
      attestation_id: attestationId,
      camera_id: cameraId,
      verdict,
      score: Math.trunc(score),
      reason_hash: reasonHash,
      source: ["cre", "cre_sim", "local"].includes(source) ? source : "cre",
    })
    .select(
      "id, attestation_id, camera_id, verdict, score, reason_hash, source, created_at",
    )
    .single();

  if (error || !row) {
    res.status(500).json({ error: "verdict_store_failed", detail: error });
    return;
  }

  await supabase
    .from("cre_reviews")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", reviewId);

  res.status(201).json({ verdict: row });
});

/**
 * Local / demo path when CRE CLI is not running: same scoring as the TEE
 * workflow, but marks source=local. Does not expose private reasons.
 */
creRouter.post("/reviews/:attestationId/run-local", async (req, res) => {
  const attestationId = String(req.params.attestationId ?? "").trim();

  const { data: attestation } = await supabase
    .from("attestations")
    .select("id, camera_id")
    .eq("id", attestationId)
    .single();

  if (!attestation) {
    res.status(404).json({ error: "attestation_not_found" });
    return;
  }

  let reviewId = String(req.body?.reviewId ?? "").trim();
  if (!reviewId) {
    const { data: review, error } = await supabase
      .from("cre_reviews")
      .insert({
        attestation_id: attestation.id,
        camera_id: attestation.camera_id,
        status: "running",
        requested_by: "local",
      })
      .select("id")
      .single();
    if (error || !review) {
      res.status(500).json({ error: "review_create_failed" });
      return;
    }
    reviewId = review.id;
  }

  const risk = await buildRiskPayload(reviewId, attestationId);
  if (!risk) {
    res.status(404).json({ error: "risk_payload_unavailable" });
    return;
  }

  const scored = scoreAttestationRisk(
    risk,
    Number(process.env.CRE_SLASH_THRESHOLD ?? "700"),
    Number(process.env.CRE_HOLD_THRESHOLD ?? "350"),
  );

  const { data: row, error: insertErr } = await supabase
    .from("cre_verdicts")
    .insert({
      review_id: reviewId,
      attestation_id: risk.attestationId,
      camera_id: risk.cameraId,
      verdict: scored.verdict,
      score: scored.score,
      reason_hash: scored.reasonHash,
      source: "local",
    })
    .select(
      "id, attestation_id, camera_id, verdict, score, reason_hash, source, created_at",
    )
    .single();

  if (insertErr || !row) {
    res.status(500).json({ error: "verdict_store_failed" });
    return;
  }

  await supabase
    .from("cre_reviews")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", reviewId);

  // Never return scored.reasons — mirrors TEE confidentiality boundary.
  res.status(201).json({
    verdict: row,
    note: "Local score mirror for UI/demo. Prize path uses cre/ + cre workflow simulate.",
  });
});

/** Health for CRE wiring (no secrets). */
creRouter.get("/health", (_req, res) => {
  const tokenSet = Boolean(creApiToken());
  res.json({
    configured: tokenSet,
    tokenFingerprint: tokenSet
      ? createHash("sha256").update(creApiToken()).digest("hex").slice(0, 12)
      : null,
  });
});
