import { supabase } from "./supabase.js";
import { issueNonce } from "./nonceStore.js";
import { verifyAttestation } from "./verify.js";
import {
  getDefaultCameraCredentials,
  getVisionServiceUrl,
} from "./settings.js";
import { publishAttestationToHcs, type HcsPublishResult } from "./chain.js";
import { slashCameraForFraud } from "./escrow.js";

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
  is_fake?: boolean | null;
  escrow_status?: "locked" | "released" | "forfeited" | null;
}

/** Stale lock older than this is treated as abandoned (crash / tab close). */
export const ATTEST_LOCK_TTL_MS = 3 * 60 * 1000;

async function acquireAttestLock(
  cameraId: string,
  lockedBy: string,
): Promise<void> {
  const staleBefore = new Date(Date.now() - ATTEST_LOCK_TTL_MS).toISOString();
  const now = new Date().toISOString();

  // Claim only if unlocked or lock is stale.
  const { data, error } = await supabase
    .from("cameras")
    .update({
      attest_locked_at: now,
      attest_locked_by: lockedBy,
    })
    .eq("id", cameraId)
    .or(`attest_locked_at.is.null,attest_locked_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error("attest_lock_failed"), {
      status: 500,
      detail: error.message,
    });
  }
  if (!data) {
    const { data: row } = await supabase
      .from("cameras")
      .select("attest_locked_at, attest_locked_by")
      .eq("id", cameraId)
      .maybeSingle();
    throw Object.assign(new Error("attest_in_progress"), {
      status: 409,
      detail:
        "Another user is already running attestation on this camera. Wait until it finishes.",
      steps: {
        lock: {
          lockedAt: row?.attest_locked_at ?? null,
          lockedBy: row?.attest_locked_by ?? null,
        },
      },
    });
  }
}

async function releaseAttestLock(cameraId: string): Promise<void> {
  await supabase
    .from("cameras")
    .update({ attest_locked_at: null, attest_locked_by: null })
    .eq("id", cameraId);
}

/** Drop abandoned locks so a page refresh doesn't show "Attest in progress". */
export async function clearStaleAttestLocks(
  supplierId?: string,
): Promise<void> {
  const staleBefore = new Date(Date.now() - ATTEST_LOCK_TTL_MS).toISOString();
  let q = supabase
    .from("cameras")
    .update({ attest_locked_at: null, attest_locked_by: null })
    .not("attest_locked_at", "is", null)
    .lt("attest_locked_at", staleBefore);
  if (supplierId) q = q.eq("supplier_id", supplierId);
  await q;
}

export interface FullAttestResult {
  attestation: Record<string, unknown>;
  hcs?: HcsPublishResult | null;
  steps: Record<string, unknown>;
  totalUnits: number;
  cmosScore: number;
  prnuScore: number | null;
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
  // Prefer this camera row's host/user/pass so Fake Cam isn't attested
  // against a shared Hikvision default (and vice versa).
  const host = (camera.host || defaults?.host || "").trim();
  const username = (camera.username || defaults?.username || "").trim();
  const password = camera.password || defaults?.password || "";
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
  opts?: { force?: boolean },
): Promise<CameraForAttest> {
  let needsEnroll = !camera.cmos_account || Boolean(opts?.force);
  if (opts?.force) {
    try {
      await fetch(`${visionUrl}/cmos/enrollment/${camera.id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Best-effort; enroll will overwrite if delete fails.
    }
  } else {
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
    const synthetic = /synthetic_device|synthetic_replay/i.test(detail || "");
    if (synthetic) {
      await slashCameraForFraud(camera.id);
      await supabase
        .from("cameras")
        .update({
          enrollment_status: "failed",
        })
        .eq("id", camera.id);
    }
    throw Object.assign(new Error("enrollment_failed"), {
      status: synthetic ? 422 : 502,
      detail:
        detail ||
        "PUF enrollment missing and live enroll failed. Check camera reachability.",
      isFake: synthetic,
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
  opts?: { nonce?: string; lockedBy?: string },
): Promise<FullAttestResult> {
  const lockedBy = opts?.lockedBy ?? "system";
  await acquireAttestLock(camera.id, lockedBy);

  try {
    return await runFullAttestationLocked(camera, opts);
  } finally {
    await releaseAttestLock(camera.id);
  }
}

async function runFullAttestationLocked(
  camera: CameraForAttest,
  opts?: { nonce?: string },
): Promise<FullAttestResult> {
  const { host, username, password } = await resolveCredentials(camera);
  const visionUrl = await getVisionServiceUrl();

  let enrolledCamera = await ensurePufEnrollment(
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

  if (camera.escrow_status !== "locked") {
    // HBAR bond is mandatory. is_fake alone does not block attest — after
    // stake, a clean attest is what clears fraud and marks Verified.
    const forfeited = camera.escrow_status === "forfeited";
    throw Object.assign(new Error("escrow_required"), {
      status: 402,
      detail: forfeited
        ? "This camera's HBAR bond was slashed for fraud. Stake 10 ℏ via x402 before attestation can resume."
        : "This camera has no active HBAR bond. Stake 10 ℏ via x402 before attestation can run.",
      isFake: Boolean(camera.is_fake) || forfeited,
    });
  }

  let { nonce } = opts?.nonce ? { nonce: opts.nonce } : issueNonce();

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

  type ChallengeJson = {
    match: boolean;
    score: number;
    correctedBitErrors?: number;
    signature?: string | null;
    signingError?: string | null;
    imageHash: string;
    osdMatch?: boolean;
    osdDecoded?: string;
    frameBase64?: string | null;
    prnuScore?: number | null;
    prnuMatch?: boolean;
    prnuAvailable?: boolean;
  };

  async function postChallenge(
    cam: CameraForAttest,
    challengeNonce: string,
  ): Promise<ChallengeJson> {
    const challengeRes = await fetch(`${visionUrl}/cmos/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cameraId: cam.id,
        cmosAccount: cam.cmos_account,
        nonce: challengeNonce,
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
    return (await challengeRes.json()) as ChallengeJson;
  }

  let imageHash: string;
  let cmosMatch = false;
  let cmosScore = 0;
  let signatureValid = false;
  let challengeFrameBase64: string | undefined;
  let prnuScore: number | null = null;
  let prnuMatch = true;
  let prnuAvailable = false;
  let osdMatch = true;
  let signingError: string | null = null;

  try {
    let challenged = await postChallenge(enrolledCamera, nonce);

    // Same physical sensor (PRNU) but BCH helper can't correct — enrollment
    // drifted with lighting/IR, or enroll/challenge capture conditions
    // diverged. Re-enroll up to a few times while PRNU still matches; do
    // not fraud-flag. Softfail stays off for synthetic devices.
    const maxStaleRefreshes = 3;
    const refreshAttempts: Array<Record<string, unknown>> = [];
    for (let refresh = 0; refresh < maxStaleRefreshes; refresh++) {
      const stale =
        !challenged.match &&
        challenged.prnuMatch !== false &&
        Boolean(challenged.prnuAvailable) &&
        /puf_enrollment_stale|PUF key regeneration failed|regenerated_address_mismatch/i.test(
          challenged.signingError || "",
        );
      if (!stale) break;

      refreshAttempts.push({
        attempt: refresh + 1,
        reason: challenged.signingError,
        prnuScore: challenged.prnuScore,
        correctedBitErrors: challenged.correctedBitErrors,
      });
      steps.enrollmentRefresh = {
        reason: challenged.signingError,
        prnuScore: challenged.prnuScore,
        attempts: refreshAttempts,
      };
      enrolledCamera = await ensurePufEnrollment(
        enrolledCamera,
        host,
        username,
        password,
        visionUrl,
        { force: true },
      );
      steps.enrollment = {
        ok: true,
        cmosAccount: enrolledCamera.cmos_account,
        ensured: true,
        refreshed: true,
        refreshCount: refresh + 1,
      };
      // Fresh nonce after re-enroll so OSD + verify stay consistent.
      nonce = issueNonce().nonce;
      steps.nonce = nonce;
      challenged = await postChallenge(enrolledCamera, nonce);
    }

    cmosMatch = challenged.match;
    cmosScore = challenged.score;
    signatureValid = Boolean(challenged.signature) && challenged.match;
    imageHash = challenged.imageHash;
    challengeFrameBase64 = challenged.frameBase64 ?? undefined;
    prnuScore = challenged.prnuScore ?? null;
    prnuMatch = challenged.prnuMatch ?? true;
    prnuAvailable = Boolean(challenged.prnuAvailable);
    osdMatch = challenged.osdMatch !== false;
    signingError = challenged.signingError ?? null;
    steps.challenge = {
      ok: challenged.match,
      match: challenged.match,
      score: challenged.score,
      correctedBitErrors: challenged.correctedBitErrors,
      signature: challenged.signature ? "present" : null,
      signingError,
      osdMatch: challenged.osdMatch,
      osdDecoded: challenged.osdDecoded,
      imageHash,
      hasFrame: Boolean(challengeFrameBase64),
      prnuScore,
      prnuMatch,
      prnuAvailable,
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

  // Synthetic / stub cameras must never pass via PUF soft-fail — flag DB
  // immediately so buyer/supplier UIs flip to Unverified.
  {
    const isSynthetic = /synthetic_device|synthetic_replay/i.test(
      signingError || "",
    );
    if (isSynthetic) {
      await slashCameraForFraud(enrolledCamera.id);
      throw Object.assign(new Error("verification_failed"), {
        status: 422,
        reasons: ["synthetic_device"],
        isFake: true,
        steps: {
          ...steps,
          cmosScore,
          prnuScore,
          fraudFlagged: true,
          signingError,
        },
      });
    }
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
    prnuFingerprintMatch: prnuMatch,
    osdMatch,
  });

  if (!verified.ok) {
    // Fraud = synthetic stub or swapped sensor. Stale PUF (BCH fail while
    // PRNU still matches) is enrollment drift, not impersonation.
    const isSynthetic = /synthetic_device|synthetic_replay/i.test(
      signingError || "",
    );
    const sensorSwap = prnuAvailable && prnuMatch === false;
    const isFraud = isSynthetic || sensorSwap;
    if (isFraud) {
      await slashCameraForFraud(enrolledCamera.id);
    }

    throw Object.assign(new Error("verification_failed"), {
      status: 422,
      reasons: verified.reasons,
      isFake: isFraud,
      steps: {
        ...steps,
        cmosScore,
        prnuScore,
        totalUnits,
        fraudFlagged: isFraud,
        signingError,
      },
    });
  }

  // Clean attest while bonded → Verified for buyers (clears is_fake).
  // Stake alone never marks Verified; slash only applies after Verified.

  await supabase
    .from("cameras")
    .update({
      is_fake: false,
      fraud_detected_at: null,
    })
    .eq("id", enrolledCamera.id);

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
      image_hash: imageHash,
      model,
      model_hash: modelHash,
      items,
      cmos_score: cmosScore,
      prnu_score: prnuScore,
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
      prnu_score: (attestation.prnu_score as number | null) ?? prnuScore,
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "hcs_publish_failed";
    const requireHcs =
      process.env.HEDERA_REQUIRE_HCS === "1" ||
      process.env.HEDERA_REQUIRE_HCS === "true";
    if (requireHcs) {
      const hint =
        /HCS not configured|HEDERA_HCS_TOPIC_ID|HEDERA_OPERATOR/i.test(msg)
          ? " Run: cd backend && npm run setup:hcs (fund OPERATOR/AGENT at portal.hedera.com)."
          : "";
      throw Object.assign(new Error(msg + hint), {
        status: 502,
        detail: "HCS publish failed",
        steps,
      });
    }
    // Demo path: settle x402 + CMOS attest even when operator key / topic
    // are not fully configured yet.
    console.warn("HCS publish skipped:", msg);
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
      prnuScore,
      hcs: hcs
        ? {
            topicId: hcs.topicId,
            sequenceNumber: hcs.sequenceNumber,
            hashscanUrl: hcs.hashscanUrl,
          }
        : null,
    },
    totalUnits,
    cmosScore,
    prnuScore,
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
        isFake:
          "isFake" in e
            ? Boolean((e as { isFake?: boolean }).isFake)
            : undefined,
      },
    };
  }
  return { status: 500, body: { error: "attest_failed" } };
}
