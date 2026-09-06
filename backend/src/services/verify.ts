import { consumeNonce } from "./nonceStore.js";

export interface AttestationVerifyInput {
  nonce: string;
  imageHash: string;
  claimedImageHash: string;
  cmosFingerprintMatch: boolean;
  signatureValid: boolean;
}

export interface VerifyResult {
  ok: boolean;
  reasons: string[];
}

// The README's verification checklist, as code. All four must pass —
// a partial pass is treated as a full failure, never a lower-confidence success.
export function verifyAttestation(input: AttestationVerifyInput): VerifyResult {
  const reasons: string[] = [];

  if (!consumeNonce(input.nonce)) reasons.push("nonce_invalid_or_expired");
  if (!input.cmosFingerprintMatch) reasons.push("cmos_mismatch");
  if (input.imageHash !== input.claimedImageHash)
    reasons.push("image_hash_mismatch");
  if (!input.signatureValid) reasons.push("signature_invalid");

  return { ok: reasons.length === 0, reasons };
}
