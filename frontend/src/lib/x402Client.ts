/**
 * Browser-side x402 exact-scheme signing (Hedera).
 * Prefer HederaWalletContext + ClientHederaSigner (WalletConnect / demo / import).
 * Backend tests keep using HEDERA_AGENT_* via /x402/sign and vitest.
 */

import type { ClientHederaSigner } from "@x402/hedera";

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

const PAYER_ID_KEY = "shelvesign_hedera_payer_id";
const PAYER_KEY_KEY = "shelvesign_hedera_payer_key";

export function getPayerCredentials(): {
  accountId: string;
  privateKey: string;
} | null {
  if (typeof window !== "undefined") {
    const sid = sessionStorage.getItem(PAYER_ID_KEY);
    const skey = sessionStorage.getItem(PAYER_KEY_KEY);
    if (sid && skey) return { accountId: sid, privateKey: skey };
  }
  const accountId = process.env.NEXT_PUBLIC_HEDERA_PAYER_ID?.trim();
  const privateKey = process.env.NEXT_PUBLIC_HEDERA_PAYER_KEY?.trim();
  if (accountId && privateKey) return { accountId, privateKey };
  return null;
}

/** Session-only payer for demo / imported accounts. */
export function setSessionPayer(accountId: string, privateKey: string) {
  sessionStorage.setItem(PAYER_ID_KEY, accountId.trim());
  sessionStorage.setItem(PAYER_KEY_KEY, privateKey.trim());
}

export function clearSessionPayer() {
  sessionStorage.removeItem(PAYER_ID_KEY);
  sessionStorage.removeItem(PAYER_KEY_KEY);
}

export function formatPaymentAmount(requirements: PaymentRequirements): string {
  const amount = Number(requirements.amount);
  if (!Number.isFinite(amount)) return requirements.amount;
  if (requirements.asset === "0.0.0") {
    return `${(amount / 100_000_000).toFixed(4)} HBAR`;
  }
  return `${(amount / 1_000_000).toFixed(4)} USDC`;
}

function toBase64Json(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Sign an x402 payment with an explicit ClientHederaSigner (wallet or local key).
 */
export async function signExactPaymentHeaderWithSigner(
  requirements: PaymentRequirements,
  signer: ClientHederaSigner,
): Promise<{ paymentHeader: string; payer: string; mock: boolean }> {
  if (
    process.env.NEXT_PUBLIC_X402_MOCK === "1" ||
    requirements.payTo.includes("mock")
  ) {
    return { paymentHeader: "mock", payer: "0.0.mock-payer", mock: true };
  }

  const { ExactHederaScheme } = await import("@x402/hedera");
  const scheme = new ExactHederaScheme(signer);
  const signed = await scheme.createPaymentPayload(2, requirements as never);

  const paymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: requirements.network,
    accepted: requirements,
    payload: signed.payload,
  };

  return {
    paymentHeader: toBase64Json(paymentPayload),
    payer: signer.accountId,
    mock: false,
  };
}

/**
 * Legacy helper — local env/session key only. Prefer wallet context + WithSigner.
 */
export async function signExactPaymentHeader(
  requirements: PaymentRequirements,
): Promise<{ paymentHeader: string; payer: string; mock: boolean }> {
  if (
    process.env.NEXT_PUBLIC_X402_MOCK === "1" ||
    requirements.payTo.includes("mock")
  ) {
    return { paymentHeader: "mock", payer: "0.0.mock-payer", mock: true };
  }

  const creds = getPayerCredentials();
  if (!creds) {
    throw new Error(
      "No Hedera payer configured. Connect a wallet or set NEXT_PUBLIC_HEDERA_PAYER_ID/KEY.",
    );
  }

  const { createClientHederaSigner, PrivateKey } = await import("@x402/hedera");
  const parseKey = (raw: string) =>
    raw.startsWith("0x")
      ? PrivateKey.fromStringECDSA(raw)
      : PrivateKey.fromString(raw);

  const network =
    (requirements.network as "hedera:testnet" | "hedera:mainnet") ||
    "hedera:testnet";

  const signer = createClientHederaSigner(
    creds.accountId,
    parseKey(creds.privateKey),
    { network },
  );
  return signExactPaymentHeaderWithSigner(requirements, signer);
}
