import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildPaymentRequirements,
  priceAmount,
  verifyAndSettle,
  x402MockMode,
  getPayTo,
} from "./x402.js";
import {
  publishAttestationToHcs,
  publishPaymentReceiptToHcs,
  hcsConfigured,
  getHcsTopicId,
} from "./chain.js";

describe("x402", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env.X402_MOCK = "1";
    process.env.X402_PRICE_PER_QUERY_USDC = "0.01";
    process.env.X402_ASSET = "0.0.0";
    delete process.env.X402_PAY_TO;
    delete process.env.HEDERA_OPERATOR_ID;
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it("enables mock mode without payTo", () => {
    expect(x402MockMode()).toBe(true);
  });

  it("prices HBAR from USDC dollars env", () => {
    // 0.01 HBAR = 1_000_000 tinybars
    expect(priceAmount()).toBe("1000000");
  });

  it("builds exact hedera requirements", async () => {
    const reqs = await buildPaymentRequirements(
      "/stock/wh/SKU-1",
      "test query",
    );
    expect(reqs.scheme).toBe("exact");
    expect(reqs.network).toMatch(/^hedera:/);
    expect(reqs.payTo).toBe(getPayTo());
    expect(reqs.amount).toBe("1000000");
    expect(reqs.resource).toBe("/stock/wh/SKU-1");
  });

  it("settles mock payment payloads", async () => {
    const requirements = await buildPaymentRequirements("/stock/a/b", "t");
    const settled = await verifyAndSettle({
      paymentRaw: "mock",
      requirements,
    });
    expect(settled.success).toBe(true);
    expect(settled.mock).toBe(true);
    expect(settled.transaction).toBeTruthy();
  });
});

describe("HCS chain", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.HEDERA_OPERATOR_KEY;
    delete process.env.HEDERA_HCS_TOPIC_ID;
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it("reports not configured without credentials", () => {
    expect(hcsConfigured()).toBe(false);
    expect(getHcsTopicId()).toContain("mock");
  });

  it("publishes attestation in mock mode", async () => {
    const result = await publishAttestationToHcs({
      id: "att-1",
      camera_id: "cam-1",
      supplier_id: "sup-1",
      camera_account: "0xabc",
      nonce: "0xn",
      image_hash: "0xh",
      model: "yolo",
      model_hash: "0xm",
      items: [{ sku: "ANGLE-IRON-3M", count: 2 }],
      cmos_score: 1,
      detection_count: 2,
      captured_at: new Date().toISOString(),
    });
    expect(result.mock).toBe(true);
    expect(result.sequenceNumber).toBeGreaterThan(0);
    expect(result.message.type).toBe("shelfsign.attestation.v1");
    expect(result.message.attestationId).toBe("att-1");
  });

  it("publishes x402 payment receipt in mock mode", async () => {
    const result = await publishPaymentReceiptToHcs({
      resource: "/stock/wh/SKU",
      amount: "1000000",
      asset: "0.0.0",
      network: "hedera:testnet",
      payer: "0.0.payer",
      payTo: "0.0.payee",
      settlementTx: "0.0.0@tx",
      warehouseId: "wh",
      sku: "SKU",
    });
    expect(result.mock).toBe(true);
    expect(result.message.type).toBe("shelfsign.x402.payment.v1");
  });
});
