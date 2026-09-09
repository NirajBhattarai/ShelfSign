import { consumeNonce } from "./nonceStore.js";

export interface AttestationVerifyInput {
  nonce: string;
  imageHash: string;
  claimedImageHash: string;
  cmosFingerprintMatch: boolean;
  signatureValid: boolean;
  /** Classical PRNU sensor-noise correlation against the enrolled
   * fingerprint (see vision-service/src/cmos/prnu.py). `true` when no
   * baseline is available yet (camera enrolled before this feature) so
   * legacy cameras aren't retroactively failed. */
  prnuFingerprintMatch: boolean;
}

export interface VerifyResult {
  ok: boolean;
  reasons: string[];
  pufSoftFail?: boolean; // true when cmos/sig checks were waived via env flag
}

// Set SHELFSIGN_ALLOW_PUF_SOFTFAIL=1 only for local debugging. Production /
// demo trust path must keep this off: nonce + CMOS/PUF + signature must all pass.
const ALLOW_PUF_SOFTFAIL =
  process.env.SHELFSIGN_ALLOW_PUF_SOFTFAIL === "1" ||
  process.env.SHELFSIGN_ALLOW_PUF_SOFTFAIL === "true";

// PRNU correlation (vision-service/src/cmos/prnu.py) uses a literature-
// typical threshold, not one calibrated against real enrolled hardware, so
// a mismatch doesn't fail verification by default — only once this is set
// does `prnu_mismatch` count as a hard failure (and thus fraud). Mirror this
// in vision-service's own SHELFSIGN_ENFORCE_PRNU to also gate its
// /cmos/challenge `match` field.
const ENFORCE_PRNU =
  process.env.SHELFSIGN_ENFORCE_PRNU === "1" ||
  process.env.SHELFSIGN_ENFORCE_PRNU === "true";

// The README's verification checklist, as code. All four must pass —
// a partial pass is treated as a full failure, never a lower-confidence success.
export function verifyAttestation(input: AttestationVerifyInput): VerifyResult {
  const reasons: string[] = [];

  if (!consumeNonce(input.nonce)) reasons.push("nonce_invalid_or_expired");
  if (!input.cmosFingerprintMatch) reasons.push("cmos_mismatch");
  if (input.imageHash !== input.claimedImageHash)
    reasons.push("image_hash_mismatch");
  if (!input.signatureValid) reasons.push("signature_invalid");
  if (ENFORCE_PRNU && !input.prnuFingerprintMatch)
    reasons.push("prnu_mismatch");

  // Soft-fail path (env only): waive PUF-specific failures. Nonce and
  // image-hash failures are never waived — those guard replay attacks.
  if (ALLOW_PUF_SOFTFAIL) {
    const pufReasons = new Set([
      "cmos_mismatch",
      "signature_invalid",
      "prnu_mismatch",
    ]);
    const remaining = reasons.filter((r) => !pufReasons.has(r));
    if (remaining.length === 0) {
      return { ok: true, reasons, pufSoftFail: reasons.length > 0 };
    }
    return { ok: false, reasons: remaining };
  }

  return { ok: reasons.length === 0, reasons };
}
