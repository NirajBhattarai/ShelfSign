/**
 * Hedera Consensus Service — publish attestation + x402 payment receipts.
 * Requires HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, and HEDERA_HCS_TOPIC_ID.
 */
import {
  Client,
  PrivateKey,
  TopicMessageSubmitTransaction,
  TopicId,
  AccountId,
} from "@hashgraph/sdk";

export type HcsNetwork = "testnet" | "mainnet";

export interface HcsPublishResult {
  topicId: string;
  sequenceNumber: number | null;
  transactionId: string | null;
  consensusTimestamp: string | null;
  hashscanUrl: string | null;
  message: Record<string, unknown>;
}

function network(): HcsNetwork {
  return process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

function mirrorBase(): string {
  return network() === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

function hashscanTx(txId: string | null): string | null {
  if (!txId) return null;
  const net = network() === "mainnet" ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/transaction/${encodeURIComponent(txId)}`;
}

function hashscanTopic(topicId: string): string {
  const net = network() === "mainnet" ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/topic/${topicId}`;
}

export function hcsConfigured(): boolean {
  const topic = process.env.HEDERA_HCS_TOPIC_ID?.trim() ?? "";
  return Boolean(
    process.env.HEDERA_OPERATOR_ID?.trim() &&
      process.env.HEDERA_OPERATOR_KEY?.trim() &&
      topic &&
      !topic.includes("mock"),
  );
}

export function getHcsTopicId(): string {
  const topic = process.env.HEDERA_HCS_TOPIC_ID?.trim();
  if (!topic || topic.includes("mock")) {
    throw new Error(
      "Set HEDERA_HCS_TOPIC_ID to a real topic (npm run setup:hcs after faucet).",
    );
  }
  return topic;
}

function buildClient(): Client {
  if (!hcsConfigured()) {
    throw new Error(
      "HCS not configured. Set HEDERA_OPERATOR_ID/KEY and HEDERA_HCS_TOPIC_ID.",
    );
  }
  const client =
    network() === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ID!);
  const keyRaw = process.env.HEDERA_OPERATOR_KEY!;
  const operatorKey = keyRaw.startsWith("0x")
    ? PrivateKey.fromStringECDSA(keyRaw)
    : PrivateKey.fromString(keyRaw);
  client.setOperator(operatorId, operatorKey);
  return client;
}

async function submitMessage(
  message: Record<string, unknown>,
): Promise<HcsPublishResult> {
  const topicId = getHcsTopicId();
  const payload = {
    ...message,
    network: `hedera:${network()}`,
    publishedAt: new Date().toISOString(),
  };

  const client = buildClient();
  try {
    const topic = TopicId.fromString(topicId);
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topic)
      .setMessage(JSON.stringify(payload))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const sequenceNumber =
      receipt.topicSequenceNumber != null
        ? Number(receipt.topicSequenceNumber.toString())
        : null;
    const transactionId = tx.transactionId?.toString() ?? null;
    return {
      topicId,
      sequenceNumber,
      transactionId,
      consensusTimestamp: new Date().toISOString(),
      hashscanUrl: hashscanTx(transactionId),
      message: payload,
    };
  } finally {
    client.close();
  }
}

export async function publishAttestationToHcs(attestation: {
  id: string;
  camera_id: string;
  supplier_id: string;
  camera_account: string | null;
  nonce: string;
  image_hash: string;
  model: string;
  model_hash: string;
  items: unknown;
  cmos_score?: number | null;
  detection_count?: number | null;
  captured_at: string;
}): Promise<HcsPublishResult> {
  return submitMessage({
    type: "shelfsign.attestation.v1",
    attestationId: attestation.id,
    cameraId: attestation.camera_id,
    supplierId: attestation.supplier_id,
    cameraAccount: attestation.camera_account,
    nonce: attestation.nonce,
    imageHash: attestation.image_hash,
    model: attestation.model,
    modelHash: attestation.model_hash,
    cmosScore: attestation.cmos_score ?? null,
    detectionCount: attestation.detection_count ?? null,
    itemSkus: Array.isArray(attestation.items)
      ? (attestation.items as Array<{ sku?: string }>)
          .map((i) => i.sku)
          .filter(Boolean)
      : [],
    capturedAt: attestation.captured_at,
  });
}

export async function publishPaymentReceiptToHcs(receipt: {
  resource: string;
  amount: string;
  asset: string;
  network: string;
  payer?: string | null;
  payTo: string;
  settlementTx?: string | null;
  warehouseId?: string;
  sku?: string;
}): Promise<HcsPublishResult> {
  return submitMessage({
    type: "shelfsign.x402.payment.v1",
    ...receipt,
  });
}

export interface HcsMirrorMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string;
  decoded?: Record<string, unknown>;
}

export async function fetchRecentHcsMessages(limit = 25): Promise<{
  topicId: string;
  topicUrl: string;
  messages: HcsMirrorMessage[];
}> {
  const topicId = getHcsTopicId();
  const url = `${mirrorBase()}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`mirror_fetch_failed:${res.status}`);
  }
  const body = (await res.json()) as {
    messages?: Array<{
      sequence_number: number;
      consensus_timestamp: string;
      message: string;
    }>;
  };

  const messages = (body.messages ?? []).map((m) => {
    let decoded: Record<string, unknown> | undefined;
    try {
      const raw = Buffer.from(m.message, "base64").toString("utf8");
      decoded = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      decoded = undefined;
    }
    return { ...m, decoded };
  });

  return {
    topicId,
    topicUrl: hashscanTopic(topicId),
    messages,
  };
}
