/**
 * Hedera HBAR camera escrow vault.
 *
 * Creates / uses a dedicated escrow account (operator-keyed) that holds HBAR
 * locked when a supplier attaches+enrolls a camera on a warehouse. Lab default
 * is 10 ℏ — easy to fund from the Hedera testnet faucet.
 */
import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  Status,
  TokenId,
  TransferTransaction,
} from "@hashgraph/sdk";
import { publishCameraEscrowToHcs, hcsConfigured } from "./chain.js";
import { supabase } from "./supabase.js";

export const HBAR_TOKEN_ID = "0.0.0";

export interface EscrowLockResult {
  escrowAccountId: string;
  tokenId: string;
  amount: number;
  transactionId: string;
  hashscanUrl: string | null;
}

function network(): "testnet" | "mainnet" {
  return process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

function hashscanTx(txId: string): string {
  const net = network() === "mainnet" ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/transaction/${encodeURIComponent(txId)}`;
}

function parseKey(raw: string): PrivateKey {
  return raw.startsWith("0x")
    ? PrivateKey.fromStringECDSA(raw)
    : PrivateKey.fromString(raw);
}

function operatorClient(): Client {
  const operatorId = process.env.HEDERA_OPERATOR_ID?.trim();
  const operatorKey = process.env.HEDERA_OPERATOR_KEY?.trim();
  if (!operatorId || !operatorKey) {
    throw new Error("HEDERA_OPERATOR_ID/KEY required for escrow");
  }
  const client =
    network() === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), parseKey(operatorKey));
  return client;
}

/** Native HBAR (`0.0.0`). ESCROW_TOKEN_ID may override for rare non-HBAR labs. */
export function escrowTokenId(): string {
  const asset = (process.env.ESCROW_TOKEN_ID || HBAR_TOKEN_ID).trim();
  return asset || HBAR_TOKEN_ID;
}

export function isHbarEscrow(tokenId = escrowTokenId()): boolean {
  return tokenId === HBAR_TOKEN_ID;
}

/**
 * Smallest units for the bond.
 * HBAR → tinybars (1 ℏ = 100_000_000). Default 10 ℏ.
 * Legacy HTS (if ESCROW_TOKEN_ID is set to a token) → 6-decimal units via
 * ESCROW_AMOUNT_USDC for backwards compatibility only.
 */
export function escrowAmountUnits(): number {
  if (isHbarEscrow()) {
    const hbar = Number(
      process.env.ESCROW_AMOUNT_HBAR ??
        process.env.ESCROW_AMOUNT_USDC ?? // migrate old env name if still present
        "10",
    );
    if (!Number.isFinite(hbar) || hbar <= 0) {
      throw new Error("ESCROW_AMOUNT_HBAR must be a positive number");
    }
    return Math.round(hbar * 100_000_000);
  }

  const usdc = Number(process.env.ESCROW_AMOUNT_USDC ?? "10");
  if (!Number.isFinite(usdc) || usdc <= 0) {
    throw new Error("ESCROW_AMOUNT_USDC must be a positive number");
  }
  return Math.round(usdc * 1_000_000);
}

export function escrowConfigured(): boolean {
  return Boolean(
    process.env.HEDERA_OPERATOR_ID?.trim() &&
    process.env.HEDERA_OPERATOR_KEY?.trim() &&
    process.env.HEDERA_ESCROW_ACCOUNT_ID?.trim(),
  );
}

export function getEscrowAccountId(): string {
  const id = process.env.HEDERA_ESCROW_ACCOUNT_ID?.trim();
  if (!id)
    throw new Error(
      "HEDERA_ESCROW_ACCOUNT_ID not set — run npm run setup:escrow",
    );
  return id;
}

/** Account that funds camera locks (warehouse bond pool). Defaults to agent. */
function funder(): { id: AccountId; key: PrivateKey } {
  const idRaw =
    process.env.ESCROW_FUNDER_ID?.trim() ||
    process.env.HEDERA_AGENT_ID?.trim() ||
    process.env.HEDERA_OPERATOR_ID?.trim();
  const keyRaw =
    process.env.ESCROW_FUNDER_KEY?.trim() ||
    process.env.HEDERA_AGENT_KEY?.trim() ||
    process.env.HEDERA_OPERATOR_KEY?.trim();
  if (!idRaw || !keyRaw) {
    throw new Error("Escrow funder id/key not configured");
  }
  return { id: AccountId.fromString(idRaw), key: parseKey(keyRaw) };
}

/**
 * Create the escrow vault account. HBAR needs no token associate.
 * Idempotent if HEDERA_ESCROW_ACCOUNT_ID already set (returns it).
 */
export async function createEscrowVault(): Promise<{
  escrowAccountId: string;
  tokenId: string;
  created: boolean;
}> {
  const tokenId = escrowTokenId();
  const existing = process.env.HEDERA_ESCROW_ACCOUNT_ID?.trim();
  if (existing) {
    return { escrowAccountId: existing, tokenId, created: false };
  }

  const client = operatorClient();
  const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!);

  try {
    const create = await new AccountCreateTransaction()
      .setKeyWithoutAlias(operatorKey.publicKey)
      .setInitialBalance(new Hbar(0.5))
      .setAccountMemo("ShelfSign camera HBAR escrow vault")
      .execute(client);
    const createRx = await create.getReceipt(client);
    if (createRx.status !== Status.Success || !createRx.accountId) {
      throw new Error(`escrow account create failed: ${createRx.status}`);
    }

    return {
      escrowAccountId: createRx.accountId.toString(),
      tokenId,
      created: true,
    };
  } finally {
    client.close();
  }
}

/**
 * Lock HBAR (or legacy HTS) into the escrow vault for a newly enrolled camera.
 */
export async function lockCameraEscrow(input: {
  cameraId: string;
  warehouseId: string;
  supplierId: string;
  label: string;
}): Promise<EscrowLockResult> {
  if (!escrowConfigured()) {
    throw new Error("Escrow not configured — run npm run setup:escrow");
  }

  const tokenId = escrowTokenId();
  const amount = escrowAmountUnits();
  const escrowAccountId = getEscrowAccountId();
  const { id: funderId, key: funderKey } = funder();
  const client = operatorClient();

  try {
    const memo = `ShelfSign camera escrow ${input.cameraId.slice(0, 8)}`;
    const txBuilder = new TransferTransaction().setTransactionMemo(
      memo.slice(0, 100),
    );

    if (isHbarEscrow(tokenId)) {
      txBuilder
        .addHbarTransfer(funderId, Hbar.fromTinybars(-amount))
        .addHbarTransfer(
          AccountId.fromString(escrowAccountId),
          Hbar.fromTinybars(amount),
        );
    } else {
      txBuilder
        .addTokenTransfer(TokenId.fromString(tokenId), funderId, -amount)
        .addTokenTransfer(
          TokenId.fromString(tokenId),
          AccountId.fromString(escrowAccountId),
          amount,
        );
    }

    const tx = await txBuilder.freezeWith(client).sign(funderKey);
    const resp = await tx.execute(client);
    const rx = await resp.getReceipt(client);
    if (rx.status !== Status.Success) {
      throw new Error(`escrow lock transfer failed: ${rx.status}`);
    }

    const transactionId = resp.transactionId.toString();
    const hashscanUrl = hashscanTx(transactionId);

    if (hcsConfigured()) {
      try {
        await publishCameraEscrowToHcs({
          action: "lock",
          cameraId: input.cameraId,
          warehouseId: input.warehouseId,
          supplierId: input.supplierId,
          label: input.label,
          escrowAccountId,
          tokenId,
          amount,
          transactionId,
        });
      } catch {
        // HCS log is best-effort; lock already settled on-chain.
      }
    }

    return {
      escrowAccountId,
      tokenId,
      amount,
      transactionId,
      hashscanUrl,
    };
  } finally {
    client.close();
  }
}

/**
 * Slash a camera's locked bond: transfer it out of the escrow vault to the
 * platform operator account. Called when a CRE fraud review returns SLASH.
 */
export async function forfeitCameraEscrow(input: {
  cameraId: string;
  warehouseId: string;
  supplierId: string;
  label: string;
  amount: number;
  tokenId: string;
}): Promise<EscrowLockResult> {
  if (!escrowConfigured()) {
    throw new Error("Escrow not configured — run npm run setup:escrow");
  }

  const escrowAccountId = getEscrowAccountId();
  const treasuryId = process.env.HEDERA_OPERATOR_ID!.trim();
  const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!.trim());
  const client = operatorClient();

  try {
    const memo = `ShelfSign camera escrow SLASH ${input.cameraId.slice(0, 8)}`;
    const txBuilder = new TransferTransaction().setTransactionMemo(
      memo.slice(0, 100),
    );

    if (isHbarEscrow(input.tokenId)) {
      txBuilder
        .addHbarTransfer(
          AccountId.fromString(escrowAccountId),
          Hbar.fromTinybars(-input.amount),
        )
        .addHbarTransfer(
          AccountId.fromString(treasuryId),
          Hbar.fromTinybars(input.amount),
        );
    } else {
      txBuilder
        .addTokenTransfer(
          TokenId.fromString(input.tokenId),
          AccountId.fromString(escrowAccountId),
          -input.amount,
        )
        .addTokenTransfer(
          TokenId.fromString(input.tokenId),
          AccountId.fromString(treasuryId),
          input.amount,
        );
    }

    const tx = await txBuilder.freezeWith(client).sign(operatorKey);
    const resp = await tx.execute(client);
    const rx = await resp.getReceipt(client);
    if (rx.status !== Status.Success) {
      throw new Error(`escrow forfeit transfer failed: ${rx.status}`);
    }

    const transactionId = resp.transactionId.toString();
    const hashscanUrl = hashscanTx(transactionId);

    if (hcsConfigured()) {
      try {
        await publishCameraEscrowToHcs({
          action: "forfeit",
          cameraId: input.cameraId,
          warehouseId: input.warehouseId,
          supplierId: input.supplierId,
          label: input.label,
          escrowAccountId,
          tokenId: input.tokenId,
          amount: input.amount,
          transactionId,
        });
      } catch {
        // HCS log is best-effort; slash already settled on-chain.
      }
    }

    return {
      escrowAccountId,
      tokenId: input.tokenId,
      amount: input.amount,
      transactionId,
      hashscanUrl,
    };
  } finally {
    client.close();
  }
}

/**
 * Fraud confirmed (CRE SLASH verdict): flag the camera and, if it has an
 * active bond, slash it. Re-staking (see cameras.ts POST /:id/restake) is
 * what clears is_fake again — a clean attestation alone no longer does.
 */
export async function slashCameraForFraud(cameraId: string): Promise<void> {
  const { data: camera } = await supabase
    .from("cameras")
    .select(
      "id, warehouse_id, supplier_id, label, escrow_status, escrow_amount, escrow_token_id",
    )
    .eq("id", cameraId)
    .maybeSingle();

  if (!camera) return;

  const patch: Record<string, unknown> = {
    is_fake: true,
    fraud_detected_at: new Date().toISOString(),
  };

  if (
    camera.escrow_status === "locked" &&
    camera.escrow_amount &&
    camera.escrow_token_id
  ) {
    try {
      const forfeit = await forfeitCameraEscrow({
        cameraId: camera.id,
        warehouseId: camera.warehouse_id,
        supplierId: camera.supplier_id,
        label: camera.label,
        amount: camera.escrow_amount,
        tokenId: camera.escrow_token_id,
      });
      patch.escrow_status = "forfeited";
      patch.escrow_forfeited_at = new Date().toISOString();
      patch.escrow_slash_tx_id = forfeit.transactionId;
      patch.escrow_slash_hashscan_url = forfeit.hashscanUrl;
    } catch (err) {
      console.error("camera escrow forfeit failed", err);
      // Still flag the camera as fake even if the on-chain slash failed.
    }
  }

  await supabase.from("cameras").update(patch).eq("id", cameraId);
}
