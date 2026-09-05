import { Router } from "express";

export const nonceRouter = Router();

// TODO: POST /nonce/challenge — issue an attestable nonce for a given warehouse/camera account
// TODO: track issued nonces (freshness, single-use) — src/services/nonce.ts
