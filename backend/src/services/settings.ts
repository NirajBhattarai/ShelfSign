import { supabase } from "./supabase.js";

const DEFAULT_BUYER_STOCK_COPY = {
  attestationBlurb:
    "Stock counts were published from this warehouse camera after a CMOS challenge. Open the proof to verify nonce, camera account, and hashes.",
  livePill: "Live warehouse camera",
  liveUnavailable: "Live camera unavailable for this warehouse",
  liveConnecting: "Connecting to live camera…",
  liveFallback: "Live feed unavailable — warehouse photo",
  overlayTitle: "Warehouse attestation",
  countLiveLabel: "Pay & attest warehouse",
  countLiveBusy: "Paying & attesting…",
  countLiveHint:
    "Pay with x402 to re-run live CMOS + nonce proof. Fake/stub cameras are flagged Unverified in the database.",
};

export type SystemSettingKey =
  | "hikvision_host"
  | "hikvision_user"
  | "hikvision_pass"
  | "vision_service_url"
  | "public_api_url"
  | "buyer_trust_checks"
  | "buyer_stock_copy";

/** Build `host` or `host:port` for ISAPI. Port 80 may be omitted.
 *  After moving camera behind a router/switch, set HIKVISION_HOST to the
 *  camera's LAN IP on that subnet (e.g. 192.168.100.64), not the old
 *  direct-link IP (e.g. 192.168.50.64). */
export function resolveHikvisionHost(
  host = process.env.HIKVISION_HOST,
  port = process.env.HIKVISION_PORT,
): string | undefined {
  const raw = host?.trim();
  if (!raw) return undefined;
  // Already has scheme or explicit port — leave as-is (strip scheme for ISAPI client).
  const withoutScheme = raw.replace(/^https?:\/\//i, "");
  if (!port?.trim() || withoutScheme.includes(":")) return withoutScheme;
  const p = port.trim();
  if (p === "80") return withoutScheme;
  return `${withoutScheme}:${p}`;
}

const ENV_FALLBACK: Record<SystemSettingKey, string | undefined> = {
  hikvision_host: resolveHikvisionHost(),
  hikvision_user: process.env.HIKVISION_USER,
  hikvision_pass: process.env.HIKVISION_PASS,
  vision_service_url: process.env.VISION_SERVICE_URL ?? "http://localhost:8000",
  public_api_url:
    process.env.PUBLIC_API_URL ??
    process.env.BACKEND_PUBLIC_URL ??
    "http://localhost:4000",
  buyer_trust_checks: undefined,
  buyer_stock_copy: undefined,
};

const DEFAULT_BUYER_TRUST_CHECKS = [
  {
    title: "CMOS / SiliconWitness identity",
    body: "Camera account matches the enrolled sensor fingerprint for this warehouse camera.",
  },
  {
    title: "Fresh challenge nonce",
    body: "Capture was bound to a one-time server nonce so a replayed old frame cannot pass.",
  },
  {
    title: "Live aisle view",
    body: "The video on this page is the same warehouse camera that signed the attestation (credentials never leave the backend).",
  },
];

/** Read one setting from the DB; fall back to process.env for bootstrap. */
export async function getSetting(
  key: SystemSettingKey,
): Promise<string | null> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (data?.value) return data.value;
  return ENV_FALLBACK[key] ?? null;
}

export async function getVisionServiceUrl(): Promise<string> {
  return (await getSetting("vision_service_url")) ?? "http://localhost:8000";
}

/** Public backend base URL used when building browser-facing stream links.
 *  Stored in system_settings — never hardcoded on the frontend. */
export async function getPublicApiUrl(): Promise<string> {
  const raw = (await getSetting("public_api_url")) ?? "http://localhost:4000";
  return raw.replace(/\/$/, "");
}

export async function getBuyerTrustChecks(): Promise<
  { title: string; body: string }[]
> {
  const raw = await getSetting("buyer_trust_checks");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { title: string; body: string }[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_BUYER_TRUST_CHECKS;
}

export async function getBuyerStockCopy(): Promise<
  typeof DEFAULT_BUYER_STOCK_COPY
> {
  const raw = await getSetting("buyer_stock_copy");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<
        typeof DEFAULT_BUYER_STOCK_COPY
      >;
      return { ...DEFAULT_BUYER_STOCK_COPY, ...parsed };
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_BUYER_STOCK_COPY;
}

/** Default Hikvision camera used for enroll/attest until per-camera
 *  credentials are configured (tomorrow). Values live in DB / env —
 *  never returned to the frontend. */
export async function getDefaultCameraCredentials(): Promise<{
  host: string;
  username: string;
  password: string;
} | null> {
  const [host, username, password] = await Promise.all([
    getSetting("hikvision_host"),
    getSetting("hikvision_user"),
    getSetting("hikvision_pass"),
  ]);
  if (!host || !username || !password) return null;
  return { host, username, password };
}

export async function upsertSetting(
  key: SystemSettingKey,
  value: string,
): Promise<void> {
  const { error } = await supabase.from("system_settings").upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`settings_upsert_failed: ${error.message}`);
}
