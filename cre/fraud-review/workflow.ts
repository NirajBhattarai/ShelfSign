import {
  cre,
  hexToBase64,
  ok,
  text,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { z } from "zod";

/**
 * ShelfSign confidential fraud review (Chainlink CRE TEE).
 *
 * Inside the enclave:
 *  1. Fetch API_TOKEN from Vault DON
 *  2. Pull pending attestation risk (camera host, is_fake, fraud flags)
 *  3. Score privately → CLEAR | HOLD | SLASH
 *  4. POST public verdict only; report verdict+score to DON
 *
 * Sensitive fields (cameraHost, private reasons) never cross usingTheDons().
 */

export const configSchema = z.object({
  schedule: z.string(),
  pendingRiskUrl: z.string(),
  verdictUrl: z.string(),
  secretId: z.string(),
  /** Fallback thresholds if API omits them (binary is not confidential). */
  slashThreshold: z.number(),
  holdThreshold: z.number(),
});

type Config = z.infer<typeof configSchema>;

type RiskPayload = {
  reviewId: string;
  attestationId: string;
  cameraId: string;
  cameraHost: string;
  enrollmentStatus: string;
  isFake: boolean;
  fraudDetectedAt: string | null;
  cmosAccount: string | null;
  attestation: {
    id: string;
    hcsTopicId: string | null;
  };
};

type PendingResponse = {
  pending: boolean;
  slashThreshold?: number;
  holdThreshold?: number;
  risk?: RiskPayload;
};

function scoreRisk(
  risk: RiskPayload,
  slashThreshold: number,
  holdThreshold: number,
): { verdict: string; score: number; reasonHash: string } {
  const reasons: string[] = [];
  let score = 0;

  if (risk.isFake) {
    score += 800;
    reasons.push("camera_flagged_fake");
  }
  if (risk.fraudDetectedAt) {
    score += 500;
    reasons.push("fraud_detected_at_set");
  }
  if (risk.enrollmentStatus !== "enrolled") {
    score += 400;
    reasons.push(`enrollment_${risk.enrollmentStatus}`);
  }
  if (!risk.attestation.hcsTopicId) {
    score += 150;
    reasons.push("missing_hcs_receipt");
  }
  if (!risk.cmosAccount) {
    score += 200;
    reasons.push("missing_cmos_account");
  }

  let hostBits = 0;
  for (let i = 0; i < risk.cameraHost.length; i++) {
    hostBits = (hostBits + risk.cameraHost.charCodeAt(i)) % 97;
  }
  score += hostBits;
  score = Math.min(score, 9999);

  const verdict =
    score >= slashThreshold ? "SLASH" : score >= holdThreshold ? "HOLD" : "CLEAR";

  const payload = `${risk.reviewId}|${risk.attestationId}|${reasons.sort().join(",")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const reasonHash = `0x${(h >>> 0).toString(16).padStart(8, "0")}`;

  return { verdict, score, reasonHash };
}

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
  const config = runtime.config;

  const apiToken = runtime.getSecret({ id: config.secretId }).result().value;

  const pendingHttp = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, {
      url: config.pendingRiskUrl,
      method: "GET",
      multiHeaders: {
        Authorization: { values: [`Bearer ${apiToken}`] },
      },
    })
    .result();

  if (!ok(pendingHttp)) {
    throw new Error(
      `pending-risk request failed with status: ${pendingHttp.statusCode}`,
    );
  }

  const pending = JSON.parse(text(pendingHttp)) as PendingResponse;
  if (!pending.pending || !pending.risk) {
    return "NO_PENDING_REVIEW";
  }

  const risk = pending.risk;
  const slashThreshold = pending.slashThreshold ?? config.slashThreshold;
  const holdThreshold = pending.holdThreshold ?? config.holdThreshold;

  const { verdict, score, reasonHash } = scoreRisk(
    risk,
    slashThreshold,
    holdThreshold,
  );

  // Simulation-only log — remove before production CRE deploy.
  runtime.log(`ShelfSign CRE enclave verdict=${verdict} score=${score}`);

  const verdictBody = Buffer.from(
    new TextEncoder().encode(
      JSON.stringify({
        reviewId: risk.reviewId,
        attestationId: risk.attestationId,
        cameraId: risk.cameraId,
        verdict,
        score,
        reasonHash,
        source: "cre",
      }),
    ),
  ).toString("base64");

  const postHttp = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, {
      url: config.verdictUrl,
      method: "POST",
      multiHeaders: {
        Authorization: { values: [`Bearer ${apiToken}`] },
        "Content-Type": { values: ["application/json"] },
      },
      body: verdictBody,
    })
    .result();

  if (!ok(postHttp)) {
    throw new Error(
      `verdict POST failed with status: ${postHttp.statusCode}`,
    );
  }

  // Cross only public fields to the Workflow DON.
  const donRuntime = runtime.usingTheDons();
  const encodedPayload = encodeAbiParameters(
    parseAbiParameters("string verdict, uint256 score, string reasonHash"),
    [verdict, BigInt(score), reasonHash],
  );

  donRuntime
    .report({
      encodedPayload: hexToBase64(encodedPayload),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  return `${verdict} (score: ${score}, attestation: ${risk.attestationId})`;
};

export function initWorkflow(config: Config) {
  const cronTrigger = new cre.capabilities.CronCapability();

  return [
    cre.handlerInTee(
      cronTrigger.trigger({ schedule: config.schedule }),
      onCronTrigger,
      [{ tee: "nitro", regions: ["us-west-2"] }],
    ),
  ];
}
