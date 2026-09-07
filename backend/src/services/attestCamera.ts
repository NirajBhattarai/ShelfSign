import { supabase } from "./supabase.js";
import { issueNonce } from "./nonceStore.js";
import { verifyAttestation } from "./verify.js";
import {
  getDefaultCameraCredentials,
  getVisionServiceUrl,
} from "./settings.js";
import { publishAttestationToHcs, type HcsPublishResult } from "./chain.js";

export interface CameraForAttest {
  id: string;
  supplier_id: string;
  host: string | null;
  username: string | null;
  password: string | null;
  cmos_account: string | null;
  enrollment_status: string;
  label?: string | null;
  warehouse_id?: string | null;
}

export interface FullAttestResult {
  attestation: Record<string, unknown>;
  hcs?: HcsPublishResult | null;
  steps: Record<string, unknown>;
  totalUnits: number;
  cmosScore: number;
  cameraId: string;
  cameraLabel: string | null;
  items: unknown[];
  model: string;
  modelHash: string;
  imageHash: string;
  engine: string;
  detectionCount: number;
  nonce: string;
  countedAt: string;
}

async function resolveCredentials(camera: CameraForAttest) {
  const defaults = await getDefaultCameraCredentials();
  // Prefer system_settings (shared Hikvision). Per-camera host/user/pass only
  // when settings are absent.
  const host = defaults?.host || camera.host;
  const username = defaults?.username || camera.username;
  const password = defaults?.password || camera.password;
  if (!host || !username || !password) {
    throw Object.assign(new Error("camera_credentials_missing"), {
      status: 503,
      detail:
        "Seed Hikvision credentials (npm run seed:camera-settings) or set camera host/user/pass.",
    });
  }
  return { host, username, password };
}

/**
 * Ensure vision-service has a real PUF enrollment for this camera before
 * challenge. Syncs cmos_account into Supabase when missing or stale.
 */
async function ensurePufEnrollment(
  camera: CameraForAttest,
  host: string,
  username: string,
  password: string,
  visionUrl: string,
): Promise<CameraForAttest> {
  let needsEnroll = !camera.cmos_account;
  try {
    const check = await fetch(`${visionUrl}/cmos/enrollment/${camera.id}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (check.ok) {
      const body = (await check.json()) as {
        enrolled?: boolean;
        cmosAccount?: string | null;
      };
      if (!body.enrolled) {
        needsEnroll = true;
      } else if (body.cmosAccount) {
        if (
          !camera.cmos_account ||
          body.cmosAccount.toLowerCase() !== camera.cmos_account.toLowerCase()
        ) {
          await supabase
            .from("cameras")
            .update({
              cmos_account: body.cmosAccount,
              enrollment_status: "enrolled",
            })
            .eq("id", camera.id);
        }
        return {
          ...camera,
          cmos_account: body.cmosAccount,
          enrollment_status: "enrolled",
        };
      }
    } else {
      needsEnroll = true;
    }
  } catch {
    needsEnroll = true;
  }

  if (!needsEnroll && camera.cmos_account) {
    return camera;
  }

  const enrollRes = await fetch(`${visionUrl}/cmos/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cameraId: camera.id,
      host,
      username,
      password,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!enrollRes.ok) {
    const detail = await enrollRes.text();
    throw Object.assign(new Error("enrollment_failed"), {
      status: 502,
      detail:
        detail ||
        "PUF enrollment missing and live enroll failed. Check camera reachability.",
    });
  }
  const { cmosAccount } = (await enrollRes.json()) as { cmosAccount: string };

  await supabase
    .from("cameras")
    .update({
      cmos_account: cmosAccount,
      enrollment_status: "enrolled",
    })
    .eq("id", camera.id);

  return {
    ...camera,
    cmos_account: cmosAccount,
    enrollment_status: "enrolled",
  };
}

/**
 * Full SiliconWitness attestation: OSD nonce + PUF challenge/sign + YOLO
 * count on the same frame, then persist (replacing prior rows for camera).
 */
export async function runFullAttestation(
  camera: CameraForAttest,
  opts?: { nonce?: string },
): Promise<FullAttestResult> {
  const { host, username, password } = await resolveCredentials(camera);
  const visionUrl = await getVisionServiceUrl();

  const enrolledCamera = await ensurePufEnrollment(
    camera,
    host,
    username,
    password,
    visionUrl,
  );

  if (
    enrolledCamera.enrollment_status !== "enrolled" ||
    !enrolledCamera.cmos_account
  ) {
    throw Object.assign(new Error("camera_not_enrolled"), {
      status: 409,
      detail: "Camera must be CMOS/PUF enrolled before attestation.",
    });
  }

  const { nonce } = opts?.nonce ? { nonce: opts.nonce } : issueNonce();

  const steps: Record<string, unknown> = {
    nonce,
    enrollment: {
      ok: true,
      cmosAccount: enrolledCamera.cmos_account,
      ensured: enrolledCamera.cmos_account !== camera.cmos_account,
    },
    challenge: null,
    detection: null,
  };

  let imageHash: string;
  let cmosMatch = false;
  let cmosScore = 0;
  let signatureValid = false;
  let challengeFrameBase64: string | undefined;

  try {
    const challengeRes = await fetch(`${visionUrl}/cmos/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cameraId: enrolledCamera.id,
        cmosAccount: enrolledCamera.cmos_account,
        nonce,
        host,
        username,
        password,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!challengeRes.ok) {
      const detail = await challengeRes.text();
      throw Object.assign(new Error("challenge_failed"), {
        status: 502,
        detail,
        steps: { ...steps, challenge: { ok: false, detail } },
      });
    }
    const challenged = (await challengeRes.json()) as {
      match: boolean;
      score: number;
      correctedBitErrors?: number;
      signature?: string | null;
      signingError?: string | null;
      imageHash: string;
      osdMatch?: boolean;
      osdDecoded?: string;
      frameBase64?: string | null;
    };
    cmosMatch = challenged.match;
    cmosScore = challenged.score;
    signatureValid = Boolean(challenged.signature) && challenged.match;
    imageHash = challenged.imageHash;
    challengeFrameBase64 = challenged.frameBase64 ?? undefined;
    steps.challenge = {
      ok: challenged.match,
      match: challenged.match,
      score: challenged.score,
      correctedBitErrors: challenged.correctedBitErrors,
      signature: challenged.signature ? "present" : null,
      signingError: challenged.signingError ?? null,
      osdMatch: challenged.osdMatch,
      osdDecoded: challenged.osdDecoded,
      imageHash,
      hasFrame: Boolean(challengeFrameBase64),
    };
    steps.cmosMatch = steps.challenge;
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    throw Object.assign(new Error("challenge_failed"), {
      status: 502,
      detail: err instanceof Error ? err.message : "unreachable",
      steps,
    });
  }

  let items: unknown[] = [];
  let model = "yolov8n-stock-v1";
  let modelHash = "";
  let totalUnits = 0;
  let detectionCount = 0;
  let engine = "ultralytics-yolov8+torch";

  // Only count categories the supplier selected for this warehouse.
  let allowedCategories: string[] = [];
  if (enrolledCamera.warehouse_id) {
    const { data: wh } = await supabase
      .from("warehouses")
      .select("categories")
      .eq("id", enrolledCamera.warehouse_id)
      .maybeSingle();
    allowedCategories = (wh?.categories as string[] | null) ?? [];
  }

  try {
    const detectBody = challengeFrameBase64
      ? {
          frameBase64: challengeFrameBase64,
          includeFrame: false,
          allowedCategories,
        }
      : {
          host,
          username,
          password,
          nonce,
          includeFrame: false,
          allowedCategories,
        };

    const detectRes = await fetch(`${visionUrl}/vision/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(detectBody),
      signal: AbortSignal.timeout(180_000),
    });
    if (!detectRes.ok) {
      const detail = await detectRes.text();
      throw Object.assign(new Error("detect_failed"), {
        status: 502,
        detail,
        steps: { ...steps, detection: { ok: false, detail } },
      });
    }
    const detected = (await detectRes.json()) as {
      items: unknown[];
      model: string;
      modelHash: string;
      imageHash: string;
      totalUnits: number;
      detectionCount: number;
      engine: string;
    };
    items = detected.items ?? [];
    model = detected.model;
    modelHash = detected.modelHash;
    imageHash = detected.imageHash || imageHash;
    totalUnits = detected.totalUnits;
    detectionCount = detected.detectionCount;
    engine = detected.engine;
    steps.detection = {
      ok: true,
      items,
      totalUnits,
      detectionCount,
      engine,
      model,
      source: challengeFrameBase64 ? "challenge_frame" : "live_recapture",
    };
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    throw Object.assign(new Error("detect_failed"), {
      status: 502,
      detail: err instanceof Error ? err.message : "unreachable",
      steps,
    });
  }

  const verified = verifyAttestation({
    nonce,
    imageHash,
    claimedImageHash: imageHash,
    cmosFingerprintMatch: cmosMatch,
    signatureValid,
  });

  if (!verified.ok) {
    throw Object.assign(new Error("verification_failed"), {
      status: 422,
      reasons: verified.reasons,
      steps: { ...steps, cmosScore, totalUnits },
    });
  }

  await supabase
    .from("attestations")
    .delete()
    .eq("camera_id", enrolledCamera.id);

  // YOLO items are camera evidence only — never write declared inventory.
  const { data: attestation, error: insertError } = await supabase
    .from("attestations")
    .insert({
      camera_id: enrolledCamera.id,
      supplier_id: enrolledCamera.supplier_id,
      camera_account: enrolledCamera.cmos_account,
      nonce,
      image_cid: null,
      image_hash: imageHash,
      model,
      model_hash: modelHash,
      items,
      cmos_score: cmosScore,
      detection_count: detectionCount,
      captured_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError || !attestation) {
    throw Object.assign(new Error("insert_failed"), {
      status: 500,
      detail: insertError?.message,
      steps,
    });
  }

  let hcs: Awaited<ReturnType<typeof publishAttestationToHcs>> | null = null;
  try {
    hcs = await publishAttestationToHcs({
      id: attestation.id as string,
      camera_id: attestation.camera_id as string,
      supplier_id: attestation.supplier_id as string,
      camera_account: (attestation.camera_account as string | null) ?? null,
      nonce: attestation.nonce as string,
      image_hash: attestation.image_hash as string,
      model: attestation.model as string,
      model_hash: attestation.model_hash as string,
      items: attestation.items,
      cmos_score: (attestation.cmos_score as number | null) ?? cmosScore,
      detection_count:
        (attestation.detection_count as number | null) ?? detectionCount,
      captured_at: attestation.captured_at as string,
    });
    await supabase
      .from("attestations")
      .update({
        hcs_topic_id: hcs.topicId,
        hcs_sequence_number: hcs.sequenceNumber,
        hcs_transaction_id: hcs.transactionId,
      })
      .eq("id", attestation.id);
  } catch {
    hcs = null;
  }

  return {
    attestation: {
      ...attestation,
      hcs_topic_id: hcs?.topicId ?? null,
      hcs_sequence_number: hcs?.sequenceNumber ?? null,
      hcs_transaction_id: hcs?.transactionId ?? null,
    },
    hcs,
    steps: {
      nonce,
      enrollment: steps.enrollment,
      challenge: steps.challenge,
      cmosMatch: steps.cmosMatch,
      detection: steps.detection,
      totalUnits,
      cmosScore,
      hcs: hcs
        ? {
            mock: hcs.mock,
            topicId: hcs.topicId,
            sequenceNumber: hcs.sequenceNumber,
            hashscanUrl: hcs.hashscanUrl,
          }
        : null,
    },
    totalUnits,
    cmosScore,
    cameraId: enrolledCamera.id,
    cameraLabel: enrolledCamera.label ?? null,
    items,
    model,
    modelHash,
    imageHash,
    engine,
    detectionCount,
    nonce,
    countedAt: new Date().toISOString(),
  };
}

export function attestErrorPayload(err: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (err && typeof err === "object") {
    const e = err as {
      message?: string;
      status?: number;
      detail?: unknown;
      reasons?: unknown;
      steps?: unknown;
    };
    return {
      status: e.status ?? 500,
      body: {
        error: e.message ?? "attest_failed",
        detail: e.detail,
        reasons: e.reasons,
        steps: e.steps,
      },
    };
  }
  return { status: 500, body: { error: "attest_failed" } };
}
