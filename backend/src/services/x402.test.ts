import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildPaymentRequirements,
  getPayTo,
  priceAmount,
  verifyAndSettle,
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
    process.env.X402_PAY_TO = "0.0.12345";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.X402_ASSET = "0.0.0";
    process.env.X402_PRICE_PER_QUERY_USDC = "0.01";
    process.env.X402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it("requires a real payTo account", () => {
    delete process.env.X402_PAY_TO;
    delete process.env.HEDERA_OPERATOR_ID;
    expect(() => getPayTo()).toThrow(/X402_PAY_TO/);
  });

  it("prices 0.01 HBAR as 1_000_000 tinybars", () => {
    expect(priceAmount()).toBe("1000000");
  });

  it("builds payment requirements with facilitator feePayer", async () => {
    const reqs = await buildPaymentRequirements("/stock/wh/SKU-1", "t");
    expect(reqs.scheme).toBe("exact");
    expect(reqs.network).toMatch(/^hedera:/);
    expect(reqs.payTo).toBe("0.0.12345");
    expect(reqs.amount).toBe("1000000");
    expect(reqs.extra?.feePayer).toMatch(/^0\.0\./);
  }, 20_000);

  it("rejects mock payment payloads", async () => {
    const requirements = await buildPaymentRequirements("/stock/a/b", "t");
    const settled = await verifyAndSettle({
      paymentRaw: "mock",
      requirements,
    });
    expect(settled.success).toBe(false);
    expect(settled.error).toBe("real_payment_signature_required");
  }, 20_000);
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
    expect(() => getHcsTopicId()).toThrow(/HEDERA_HCS_TOPIC_ID/);
  });

  it("refuses attestation publish without HCS config", async () => {
    await expect(
      publishAttestationToHcs({
        id: "att-1",
        camera_id: "cam",
        supplier_id: "sup",
        camera_account: null,
        nonce: "0x1",
        image_hash: "0x2",
        model: "m",
        model_hash: "0x3",
        items: [],
        captured_at: new Date().toISOString(),
      }),
    ).rejects.toThrow(/HCS|HEDERA/);
  });

  it("refuses payment receipt publish without HCS config", async () => {
    await expect(
      publishPaymentReceiptToHcs({
        resource: "/stock/x/y",
        amount: "1",
        asset: "0.0.0",
        network: "hedera:testnet",
        payer: "0.0.1",
        payTo: "0.0.2",
      }),
    ).rejects.toThrow(/HCS|HEDERA/);
  });
});
