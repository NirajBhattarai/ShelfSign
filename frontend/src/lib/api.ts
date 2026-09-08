import { supabase } from "./supabase";
import type { ClientHederaSigner } from "@x402/hedera";
import type { PaymentRequirements } from "./x402Client";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface X402Challenge {
  x402Version: 2;
  accepts?: PaymentRequirements[];
  error?: string;
  resource?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Paid x402 GET — on 402, signs with wallet, then retries with PAYMENT-SIGNATURE.
 */
export async function apiGetPaid<T>(
  path: string,
  opts?: {
    paymentSignature?: string;
    /** Provide a ClientHederaSigner from HederaWalletContext. */
    getSigner?: () => Promise<ClientHederaSigner>;
    /** Called with the 402 body before signing. Return false to abort. */
    onChallenge?: (
      challenge: X402Challenge,
    ) => boolean | Promise<boolean>;
  },
): Promise<T> {
  const headers = await authHeaders();

  // If caller already signed, skip the unpaid probe.
  if (opts?.paymentSignature) {
    const paid = await fetch(`${API_URL}${path}`, {
      headers: {
        ...headers,
        "PAYMENT-SIGNATURE": opts.paymentSignature,
      },
    });
    if (!paid.ok) {
      const detail = await paid.json().catch(() => null);
      throw new Error(
        detail?.error ??
          detail?.detail ??
          `Paid GET ${path} failed: ${paid.status}`,
      );
    }
    return paid.json() as Promise<T>;
  }

  const first = await fetch(`${API_URL}${path}`, { headers });
  if (first.status !== 402) {
    if (!first.ok) throw new Error(`GET ${path} failed: ${first.status}`);
    return first.json() as Promise<T>;
  }

  const challenge = (await first.json()) as X402Challenge;

  if (opts?.onChallenge) {
    const ok = await opts.onChallenge(challenge);
    if (!ok) throw new Error("Payment cancelled");
  }

  const requirements = challenge.accepts?.[0];
  if (!requirements) {
    throw new Error(
      challenge.error ?? "Payment required (x402) but no accepts[] in 402.",
    );
  }
  const { signExactPaymentHeader, signExactPaymentHeaderWithSigner } =
    await import("./x402Client");
  let signature: string;
  if (opts?.getSigner) {
    const signer = await opts.getSigner();
    const signed = await signExactPaymentHeaderWithSigner(
      requirements,
      signer,
    );
    signature = signed.paymentHeader;
  } else {
    const signed = await signExactPaymentHeader(requirements);
    signature = signed.paymentHeader;
  }

  const paid = await fetch(`${API_URL}${path}`, {
    headers: {
      ...headers,
      "PAYMENT-SIGNATURE": signature,
    },
  });
  if (!paid.ok) {
    const detail = await paid.json().catch(() => null);
    throw new Error(
      detail?.error ??
        detail?.detail ??
        `Paid GET ${path} failed: ${paid.status}`,
    );
  }
  return paid.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  reasons: string[];
  isFake?: boolean;
  detail: unknown;

  constructor(opts: {
    message: string;
    status: number;
    reasons?: string[];
    isFake?: boolean;
    detail?: unknown;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.reasons = opts.reasons ?? [];
    this.isFake = opts.isFake;
    this.detail = opts.detail;
  }
}

export function fraudReasonsFrom(err: unknown): string[] {
  if (err instanceof ApiError && err.reasons.length) return err.reasons;
  const msg = err instanceof Error ? err.message : "";
  return ["cmos_mismatch", "signature_invalid"].filter(
    (r) => msg.includes(r),
  );
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const reasons: string[] = Array.isArray(detail?.reasons)
      ? detail.reasons.map(String)
      : [];
    const message =
      (typeof detail?.detail === "string" && detail.detail) ||
      (reasons.length ? reasons.join(", ") : null) ||
      detail?.error ||
      `POST ${path} failed: ${res.status}`;
    throw new ApiError({
      message: typeof message === "string" ? message : JSON.stringify(message),
      status: res.status,
      reasons,
      isFake: Boolean(detail?.isFake ?? detail?.steps?.fraudFlagged),
      detail,
    });
  }
  return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `PUT ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `PATCH ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
