/**
 * x402 resource-server helpers for Hedera (exact scheme via Blocky402 / x402.org).
 *
 * Flow: client hits paywalled route → 402 + accepts[] → client signs TransferTransaction
 * → retries with PAYMENT-SIGNATURE → we /verify + /settle at the facilitator → grant access
 * and publish a payment receipt to HCS.
 */
import type { NextFunction, Request, Response } from "express";
import { publishPaymentReceiptToHcs } from "./chain.js";

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  description?: string;
  mimeType?: string;
  resource?: string;
  extra?: { feePayer?: string };
}

export interface X402Challenge {
  x402Version: 2;
  accepts: PaymentRequirements[];
  error?: string;
  resource: string;
}

function facilitatorUrl(): string {
  return (
    process.env.X402_FACILITATOR_URL ||
    (process.env.HEDERA_NETWORK === "mainnet"
      ? "https://api.blocky402.com"
      : "https://api.testnet.blocky402.com")
  );
}

function caipNetwork(): string {
  return process.env.HEDERA_NETWORK === "mainnet"
    ? "hedera:mainnet"
    : "hedera:testnet";
}

/** Retail price in tinybars — always native HBAR (0.01 ℏ default). */
export function priceAmount(): string {
  const hbar = Number(
    process.env.X402_PRICE_PER_QUERY_HBAR ??
      process.env.X402_PRICE_PER_QUERY_USDC ?? // legacy env alias
      "0.01",
  );
  if (!Number.isFinite(hbar) || hbar <= 0) {
    throw new Error("X402_PRICE_PER_QUERY_HBAR must be a positive HBAR amount");
  }
  // 1 HBAR = 100_000_000 tinybars
  return String(Math.max(1, Math.round(hbar * 100_000_000)));
}

/** Native HBAR only for retail x402 (token id 0.0.0). */
export function x402Asset(): string {
  const asset = (process.env.X402_ASSET ?? "0.0.0").trim() || "0.0.0";
  if (asset !== "0.0.0") {
    console.warn(
      `X402_ASSET=${asset} ignored — retail x402 is HBAR-only (0.0.0).`,
    );
  }
  return "0.0.0";
}

export function getPayTo(): string {
  const payTo =
    process.env.X402_PAY_TO?.trim() ||
    process.env.HEDERA_OPERATOR_ID?.trim() ||
    "";
  if (!payTo || payTo.includes("mock")) {
    throw new Error(
      "Set X402_PAY_TO or HEDERA_OPERATOR_ID to a real Hedera account.",
    );
  }
  return payTo;
}

export async function discoverFeePayer(): Promise<string> {
  const res = await fetch(`${facilitatorUrl()}/supported`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`facilitator_supported_failed:${res.status}`);
  }
  const body = (await res.json()) as {
    kinds?: Array<{ network?: string; extra?: { feePayer?: string } }>;
    signers?: Record<string, string[]>;
  };
  const kind = body.kinds?.find((k) => k.network === caipNetwork());
  const feePayer =
    kind?.extra?.feePayer ?? body.signers?.["hedera:*"]?.[0] ?? undefined;
  if (!feePayer) {
    throw new Error(
      `No Hedera feePayer from facilitator ${facilitatorUrl()} for ${caipNetwork()}`,
    );
  }
  return feePayer;
}

export async function buildPaymentRequirements(
  resource: string,
  description: string,
): Promise<PaymentRequirements> {
  const feePayer = await discoverFeePayer();
  return {
    scheme: "exact",
    network: caipNetwork(),
    amount: priceAmount(),
    payTo: getPayTo(),
    maxTimeoutSeconds: 300,
    asset: x402Asset(),
    description,
    mimeType: "application/json",
    resource,
    extra: { feePayer },
  };
}

export function paymentHeader(req: Request): string | null {
  const h =
    req.header("PAYMENT-SIGNATURE") ||
    req.header("payment-signature") ||
    req.header("X-PAYMENT") ||
    req.header("x-payment");
  return h?.trim() || null;
}

function parsePaymentPayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {
      return { raw };
    }
  }
}

export interface SettleResult {
  success: boolean;
  payer?: string | null;
  transaction?: string | null;
  error?: string;
}

export async function verifyAndSettle(opts: {
  paymentRaw: string;
  requirements: PaymentRequirements;
}): Promise<SettleResult> {
  const raw = opts.paymentRaw.trim();
  if (!raw || raw === "mock" || raw === "1" || raw.startsWith("mock:")) {
    return {
      success: false,
      error: "real_payment_signature_required",
    };
  }

  const paymentPayload = parsePaymentPayload(raw);
  const body = {
    x402Version: 2,
    paymentPayload,
    paymentRequirements: opts.requirements,
  };

  const verifyRes = await fetch(`${facilitatorUrl()}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const verifyJson = (await verifyRes.json().catch(() => ({}))) as {
    isValid?: boolean;
    invalidReason?: string;
    invalidMessage?: string;
    payer?: string;
  };
  if (!verifyRes.ok || !verifyJson.isValid) {
    return {
      success: false,
      error:
        verifyJson.invalidMessage ||
        verifyJson.invalidReason ||
        `verify_failed:${verifyRes.status}`,
    };
  }

  const settleRes = await fetch(`${facilitatorUrl()}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const settleJson = (await settleRes.json().catch(() => ({}))) as {
    success?: boolean;
    transaction?: string;
    payer?: string;
    errorMessage?: string;
    errorReason?: string;
  };
  if (!settleRes.ok || !settleJson.success) {
    return {
      success: false,
      payer: verifyJson.payer,
      error:
        settleJson.errorMessage ||
        settleJson.errorReason ||
        `settle_failed:${settleRes.status}`,
    };
  }

  return {
    success: true,
    payer: settleJson.payer ?? verifyJson.payer,
    transaction: settleJson.transaction ?? null,
  };
}

export type PaidRequest = Request & {
  x402?: {
    requirements: PaymentRequirements;
    settlement: SettleResult;
    hcs?: Awaited<ReturnType<typeof publishPaymentReceiptToHcs>>;
  };
};

/**
 * Express middleware: require a settled x402 payment before the handler runs.
 */
export function requireX402Payment(opts: {
  description: string;
  resourcePath?: (req: Request) => string;
}) {
  return async (req: PaidRequest, res: Response, next: NextFunction) => {
    try {
      const resource =
        opts.resourcePath?.(req) ??
        `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      const requirements = await buildPaymentRequirements(
        resource,
        opts.description,
      );
      const payment = paymentHeader(req);

      if (!payment) {
        const challenge: X402Challenge = {
          x402Version: 2,
          accepts: [requirements],
          resource,
          error: "Payment required to access attested stock query",
        };
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "WWW-Authenticate",
          `x402 scheme="exact" network="${requirements.network}"`,
        );
        res.status(402).json(challenge);
        return;
      }

      const settlement = await verifyAndSettle({
        paymentRaw: payment,
        requirements,
      });
      if (!settlement.success) {
        res.status(402).json({
          x402Version: 2,
          error: settlement.error ?? "payment_invalid",
          accepts: [requirements],
          resource,
        });
        return;
      }

      let hcs:
        Awaited<ReturnType<typeof publishPaymentReceiptToHcs>> | undefined;
      try {
        hcs = await publishPaymentReceiptToHcs({
          resource,
          amount: requirements.amount,
          asset: requirements.asset,
          network: requirements.network,
          payer: settlement.payer,
          payTo: requirements.payTo,
          settlementTx: settlement.transaction,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("x402 payment HCS receipt skipped:", msg);
      }

      req.x402 = { requirements, settlement, hcs };
      next();
    } catch (err) {
      next(err);
    }
  };
}
