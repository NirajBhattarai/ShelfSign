import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { requireX402Payment } from "../services/x402.js";

describe("requireX402Payment middleware", () => {
  let baseUrl = "";
  let server: Server | null = null;

  beforeEach(async () => {
    process.env.X402_MOCK = "1";
    process.env.X402_PRICE_PER_QUERY_USDC = "0.01";
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.X402_PAY_TO;

    const app = express();
    app.get(
      "/paid",
      requireX402Payment({ description: "test resource" }),
      (_req, res) => {
        res.json({ ok: true, paid: true });
      },
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = null;
  });

  it("returns 402 challenge without payment header", async () => {
    const res = await fetch(`${baseUrl}/paid`);
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      x402Version: number;
      accepts: Array<{ scheme: string; network: string }>;
      mock?: boolean;
    };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]?.scheme).toBe("exact");
    expect(body.accepts[0]?.network).toMatch(/^hedera:/);
    expect(body.mock).toBe(true);
  });

  it("grants access with mock payment header", async () => {
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { "PAYMENT-SIGNATURE": "mock" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; paid: boolean };
    expect(body.ok).toBe(true);
    expect(body.paid).toBe(true);
  });
});
