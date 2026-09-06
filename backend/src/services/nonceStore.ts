import { randomBytes } from "node:crypto";

const NONCE_TTL_MS = 2 * 60 * 1000;

// In-memory, single-instance store: fine for a hackathon deploy where
// nonces are short-lived and don't need to survive a restart.
const issued = new Map<string, number>();

export function issueNonce(): { nonce: string; expiresInMs: number } {
  const nonce = "0x" + randomBytes(16).toString("hex");
  issued.set(nonce, Date.now() + NONCE_TTL_MS);
  return { nonce, expiresInMs: NONCE_TTL_MS };
}

// Single-use: a valid nonce is consumed on first check, so replaying
// the same nonce (old footage, a captured challenge) fails the second time.
export function consumeNonce(nonce: string): boolean {
  const expiry = issued.get(nonce);
  if (!expiry) return false;
  issued.delete(nonce);
  return expiry > Date.now();
}
