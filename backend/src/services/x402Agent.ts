/**
 * Agent-side x402 payer — signs Hedera exact-scheme payments with HEDERA_AGENT_*.
 */
import {
  ExactHederaScheme,
  createClientHederaSigner,
  PrivateKey,
} from "@x402/hedera";
import type { PaymentRequirements } from "./x402.js";
import {
  buildPaymentRequirements,
  x402MockMode,
  verifyAndSettle,
} from "./x402.js";

function agentConfigured(): boolean {
  return Boolean(process.env.HEDERA_AGENT_ID && process.env.HEDERA_AGENT_KEY);
}

function parseKey(raw: string) {
  return raw.startsWith("0x")
    ? PrivateKey.fromStringECDSA(raw)
    : PrivateKey.fromString(raw);
}

export async function signExactPayment(
  requirements: PaymentRequirements,
): Promise<{ paymentHeader: string; mock: boolean }> {
  if (x402MockMode()) {
    return { paymentHeader: "mock", mock: true };
  }
  if (!agentConfigured()) {
    throw Object.assign(new Error("hedera_agent_not_configured"), {
      status: 503,
      detail:
        "Set HEDERA_AGENT_ID + HEDERA_AGENT_KEY (run npm run setup:hedera).",
    });
  }

  const network =
    (requirements.network as "hedera:testnet" | "hedera:mainnet") ||
    "hedera:testnet";
  const signer = createClientHederaSigner(
    process.env.HEDERA_AGENT_ID!,
    parseKey(process.env.HEDERA_AGENT_KEY!),
    { network },
  );
  const scheme = new ExactHederaScheme(signer);
  const signed = await scheme.createPaymentPayload(2, requirements as never);

  const paymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: requirements.network,
    accepted: requirements,
    payload: signed.payload,
  };

  // Facilitator accepts JSON body; our middleware also accepts base64/JSON header.
  return {
    paymentHeader: Buffer.from(JSON.stringify(paymentPayload)).toString(
      "base64",
    ),
    mock: false,
  };
}

export async function payForResource(resource: string, description: string) {
  const requirements = await buildPaymentRequirements(resource, description);
  const { paymentHeader, mock } = await signExactPayment(requirements);
  const settlement = await verifyAndSettle({
    paymentRaw: paymentHeader,
    requirements,
  });
  return { requirements, paymentHeader, settlement, mock };
}
