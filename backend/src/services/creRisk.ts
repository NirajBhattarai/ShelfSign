/** Shared confidential risk scoring for CRE TEE + local sim. */

export type CreVerdict = "CLEAR" | "HOLD" | "SLASH";

export interface AttestationRiskPayload {
  reviewId: string;
  attestationId: string;
  cameraId: string;
  /** Sensitive — camera LAN host; never returned in public verdict. */
  cameraHost: string;
  cameraLabel: string | null;
  enrollmentStatus: string;
  isFake: boolean;
  fraudDetectedAt: string | null;
  cmosAccount: string | null;
  attestation: {
    id: string;
    capturedAt: string;
    imageHash: string;
    hcsTopicId: string | null;
    hcsSequenceNumber: number | null;
  };
}

export interface CreScoreResult {
  verdict: CreVerdict;
  score: number;
  /** Hash of private reasons — public, non-reversible. */
  reasonHash: string;
  /** Private reasons — must stay inside TEE / never return to clients. */
  reasons: string[];
}

export function scoreAttestationRisk(
  risk: AttestationRiskPayload,
  slashThreshold = 700,
  holdThreshold = 350,
): CreScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (risk.isFake) {
    score += 800;
    reasons.push("camera_flagged_fake");
  }
  if (risk.fraudDetectedAt) {
    score += 500;
    reasons.push("fraud_detected_at_set");
  }
  if (risk.enrollmentStatus !== "enrolled") {
    score += 400;
    reasons.push(`enrollment_${risk.enrollmentStatus}`);
  }
  if (!risk.attestation.hcsTopicId) {
    score += 150;
    reasons.push("missing_hcs_receipt");
  }
  if (!risk.cmosAccount) {
    score += 200;
    reasons.push("missing_cmos_account");
  }

  // Host fingerprint contribution (sensitive string) — keeps intermediate
  // computation dependent on private API payload without leaking the host.
  let hostBits = 0;
  for (let i = 0; i < risk.cameraHost.length; i++) {
    hostBits = (hostBits + risk.cameraHost.charCodeAt(i)) % 97;
  }
  score += hostBits;
  score = Math.min(score, 9999);

  const verdict: CreVerdict =
    score >= slashThreshold ? "SLASH" : score >= holdThreshold ? "HOLD" : "CLEAR";

  const reasonHash = hashReasons(reasons, risk.attestationId, risk.reviewId);

  return { verdict, score, reasonHash, reasons };
}

function hashReasons(
  reasons: string[],
  attestationId: string,
  reviewId: string,
): string {
  const payload = `${reviewId}|${attestationId}|${reasons.sort().join(",")}`;
  // FNV-1a 32-bit — deterministic, no crypto dependency in workflow wasm.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `0x${(h >>> 0).toString(16).padStart(8, "0")}`;
}
