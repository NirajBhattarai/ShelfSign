# ShelfSign Hedera camera HBAR escrow

When a supplier **attaches and enrolls a camera** on a warehouse, ShelfSign
locks a **10 HBAR fraud bond** into a dedicated Hedera **escrow vault
account** (operator-keyed) as proof the camera is economically backed. HBAR
is easy to fund from the [Hedera testnet faucet](https://faucet.hedera.com).

**This is mandatory, not optional.** `POST /cameras` refuses to enroll a
camera at all if escrow isn't configured (503 `escrow_not_configured`), and
if the CMOS/PUF enroll succeeds but the escrow lock transfer itself fails,
the camera is marked `enrollment_status = 'failed'` (502
`escrow_lock_failed`) rather than being enrolled without a bond. There is no
enrolled camera in this system without an active HBAR lock behind it.

## Slash + restake lifecycle

1. **Lock** — camera enrolls → `lockCameraEscrow()` moves `ESCROW_AMOUNT_HBAR`
   (default 10 ℏ) from the funder into the vault. `escrow_status = 'locked'`.
   If this fails, enrollment fails with it — never optional.
2. **Slash** — fraud is confirmed → `slashCameraForFraud()` transfers the
   locked bond out of the vault to the platform operator account, flags
   `cameras.is_fake = true`, and sets `escrow_status = 'forfeited'`. The
   supplier does not get this back.
3. **Blocked** — while `escrow_status = 'forfeited'`, `runFullAttestation()`
   refuses to run (402 `escrow_required`) for both the supplier's own
   `/cameras/:id/attest` and the buyer-paid `/warehouses/:id/count-live`.
4. **Restake** — supplier calls `POST /cameras/:id/restake`, which locks a
   fresh 10 HBAR bond, sets `escrow_status = 'locked'`, and clears
   `is_fake` / `fraud_detected_at`. Attestation resumes.

The prior slash is preserved for audit in `escrow_forfeited_at` /
`escrow_slash_tx_id` / `escrow_slash_hashscan_url` — restaking updates the
_active_ lock fields (`escrow_tx_id`, `escrow_amount`, …) but does not erase
the slash history.

## Why an account vault (not Solidity)?

Native HBAR custody is a Hedera account + `TransferTransaction.addHbarTransfer`.
That matches the rest of this repo (`@hashgraph/sdk`) and needs no HTS
associate step for the vault.

## Setup

```bash
cd backend
# Requires HEDERA_OPERATOR_* already set.
# Funder defaults to HEDERA_AGENT_* (must hold ≥10 ℏ per camera lock).
npm run setup:escrow
```

Writes:

- `HEDERA_ESCROW_ACCOUNT_ID`
- `ESCROW_TOKEN_ID=0.0.0`
- `ESCROW_AMOUNT_HBAR` (default `10`)

## Lock path

`POST /cameras` → CMOS enroll success → `lockCameraEscrow()`:

1. Transfer `ESCROW_AMOUNT_HBAR` (tinybars) from funder → escrow vault
2. Persist `escrow_*` columns on `cameras` (`escrow_token_id = 0.0.0`)
3. Best-effort HCS message `shelfsign.camera_escrow.v1` (`action: "lock"`)

Restake after a slash (`POST /cameras/:id/restake`) runs the same
`lockCameraEscrow()` path a second time.

## Slash path

Fraud confirmed → `slashCameraForFraud(cameraId)`:

1. Transfer the camera's locked `escrow_amount` from vault → operator account
2. `cameras.escrow_status = 'forfeited'`, `is_fake = true`, `fraud_detected_at` set
3. Best-effort HCS message `shelfsign.camera_escrow.v1` (`action: "slash"`)

## Env

```bash
HEDERA_ESCROW_ACCOUNT_ID=0.0.…
ESCROW_TOKEN_ID=0.0.0
ESCROW_AMOUNT_HBAR=10
ESCROW_FUNDER_ID=              # optional; default HEDERA_AGENT_ID
ESCROW_FUNDER_KEY=
```
