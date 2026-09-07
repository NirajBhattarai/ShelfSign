/**
 * Agent-side x402 payer — signs Hedera exact-scheme payments with HEDERA_AGENT_*.
 */
import {
  ExactHederaScheme,
  createClientHederaSigner,
  PrivateKey,
} from "@x402/hedera";
import type { PaymentRequirements } from "./x402.js";
import { buildPaymentRequirements, verifyAndSettle } from "./x402.js";

function agentConfigured(): boolean {
  return Boolean(
    process.env.HEDERA_AGENT_ID?.trim() && process.env.HEDERA_AGENT_KEY?.trim(),
  );
}

function parseKey(raw: string) {
  return raw.startsWith("0x")
    ? PrivateKey.fromStringECDSA(raw)
    : PrivateKey.fromString(raw);
}

export async function signExactPayment(
  requirements: PaymentRequirements,
): Promise<{ paymentHeader: string }> {
  if (!agentConfigured()) {
    throw Object.assign(new Error("hedera_agent_not_configured"), {
      status: 503,
      detail:
        "Set HEDERA_AGENT_ID + HEDERA_AGENT_KEY (run npm run setup:hcs after faucet).",
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

  return {
    paymentHeader: Buffer.from(JSON.stringify(paymentPayload)).toString(
      "base64",
    ),
  };
}

export async function payForResource(resource: string, description: string) {
  const requirements = await buildPaymentRequirements(resource, description);
  const { paymentHeader } = await signExactPayment(requirements);
  const settlement = await verifyAndSettle({
    paymentRaw: paymentHeader,
    requirements,
  });
  return { requirements, paymentHeader, settlement };
}
