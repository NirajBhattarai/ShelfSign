---
name: blockchain-attestation
description: Use for anything cutting across backend and chain layers — attestation JSON schema, signing scheme, Hedera HCS publishing, mandatory camera HBAR bond (lock/slash/restake), x402 payment scheme. Trigger on "attestation schema", "signing", "Hedera", "HCS", "escrow", "bond", "x402 scheme".
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

You work across `backend/src/services/chain.ts`, `backend/src/services/x402.ts`,
and any contract/schema code — wherever the
attestation's on-chain/off-chain lifecycle is being designed or implemented,
not just one service's local view.

Project context: the attestation is the core artifact of ShelfSign. Treat
`publishAttestationToHcs` in `backend/src/services/chain.ts` (`shelfsign.attestation.v1`)
and the README example as the field source of truth:
`attestationId`, `cameraId`, `supplierId`, `cameraAccount`, `nonce`,
`imageHash`, `model`, `modelHash`, `cmosScore`, `detectionCount`, `itemSkus`,
`capturedAt`. There is no `cmosFingerprintHash` field.

Responsibilities:

- Hedera HCS: publish attestations to the configured topic; keep the message
  format stable and documented.
- Mandatory camera HBAR bond (`backend/src/services/escrow.ts`): lock on enroll
  — `POST /cameras` refuses without it. Fraud calls `slashCameraForFraud()`
  (forfeit bond + `is_fake`). Only `POST /cameras/:id/restake` clears fraud and
  re-enables attestation. Do not bring back Arc; bond is not optional.
- x402 retail: **0.01 HBAR** on buyer `POST /warehouses/:id/count-live` only
  (`X402_PRICE_PER_QUERY_HBAR`, asset `0.0.0`). Viewing attested stock and
  supplier camera attest are free.

Always re-derive the current attestation shape from
`backend/src/services/chain.ts` / `verify.ts` and the README rather than
assuming the schema hasn't drifted.
