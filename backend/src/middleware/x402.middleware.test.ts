import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { requireX402Payment } from "../services/x402.js";

describe("x402 middleware (real settle only)", () => {
  const prev = { ...process.env };
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    process.env.X402_PAY_TO = "0.0.12345";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.X402_ASSET = "0.0.0";
    process.env.X402_PRICE_PER_QUERY_HBAR = "0.01";
    process.env.X402_FACILITATOR_URL = "https://api.testnet.blocky402.com";

    const app = express();
    app.get(
      "/paid",
      requireX402Payment({ description: "test" }),
      (_req, res) => {
        res.json({ ok: true, paid: true });
      },
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    process.env = { ...prev };
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns 402 challenge without payment", async () => {
    const res = await fetch(`${baseUrl}/paid`);
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      x402Version: number;
      accepts: Array<{ scheme: string; network: string; payTo: string }>;
    };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]?.scheme).toBe("exact");
    expect(body.accepts[0]?.network).toMatch(/^hedera:/);
    expect(body.accepts[0]?.payTo).toBe("0.0.12345");
  }, 20_000);

  it("rejects mock payment header", async () => {
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { "PAYMENT-SIGNATURE": "mock" },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("real_payment_signature_required");
  }, 20_000);
});
