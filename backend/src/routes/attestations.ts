import { Router } from "express";

export const attestationRouter = Router();

// TODO: POST /attestations — receive signed attestation from warehouse agent, verify
//   (nonce fresh, CMOS fingerprint match, image hash, signature), then publish to Hedera HCS
// TODO: GET /attestations/:id — fetch a published attestation
