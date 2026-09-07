/**
 * Live Hedera testnet integration — skipped unless ONCHAIN=1 and credentials set.
 */
import { describe, it, expect } from "vitest";
import {
  publishAttestationToHcs,
  hcsConfigured,
  fetchRecentHcsMessages,
} from "./chain.js";
import { buildPaymentRequirements, x402MockMode } from "./x402.js";
import { signExactPayment } from "./x402Agent.js";
import { verifyAndSettle } from "./x402.js";

const run = process.env.ONCHAIN === "1";

describe.runIf(run)("Hedera on-chain (testnet)", () => {
  it("has credentials and mock disabled", () => {
    expect(hcsConfigured()).toBe(true);
    expect(x402MockMode()).toBe(false);
    expect(process.env.HEDERA_AGENT_ID).toBeTruthy();
    expect(process.env.HEDERA_AGENT_KEY).toBeTruthy();
  });

  it("publishes an attestation to HCS", async () => {
    const result = await publishAttestationToHcs({
      id: `att-onchain-${Date.now()}`,
      camera_id: "cam-test",
      supplier_id: "sup-test",
      camera_account: "0xShelfSignTest",
      nonce: `0x${Date.now().toString(16)}`,
      image_hash: "0xdeadbeef",
      model: "yolov8n-stock-v1",
      model_hash: "0xmodel",
      items: [{ sku: "ANGLE-IRON-3M", count: 1 }],
      cmos_score: 1,
      detection_count: 1,
      captured_at: new Date().toISOString(),
    });
    expect(result.mock).toBe(false);
    expect(result.topicId).toMatch(/^0\.0\./);
    expect(result.sequenceNumber).toBeGreaterThan(0);
    expect(result.transactionId).toBeTruthy();
    console.log("HCS", result.hashscanUrl ?? result.transactionId);
  }, 60_000);

  it("signs and settles an x402 HBAR payment via Blocky402", async () => {
    const requirements = await buildPaymentRequirements(
      `/stock/onchain-test/${Date.now()}`,
      "ShelfSign on-chain integration test",
    );
    expect(requirements.extra?.feePayer).toBeTruthy();
    const signed = await signExactPayment(requirements);
    expect(signed.mock).toBe(false);

    const settled = await verifyAndSettle({
      paymentRaw: signed.paymentHeader,
      requirements,
    });
    expect(settled.success).toBe(true);
    expect(settled.mock).toBe(false);
    expect(settled.transaction).toBeTruthy();
    console.log("x402 settle", settled.transaction, "payer", settled.payer);
  }, 120_000);

  it("reads recent messages from mirror", async () => {
    const recent = await fetchRecentHcsMessages(5);
    expect(recent.mock).toBe(false);
    expect(recent.topicId).toBe(process.env.HEDERA_HCS_TOPIC_ID);
    expect(recent.messages.length).toBeGreaterThan(0);
  }, 30_000);
});
