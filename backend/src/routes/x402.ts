import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { buildPaymentRequirements } from "../services/x402.js";
import { signExactPayment } from "../services/x402Agent.js";

export const x402Router = Router();

x402Router.use(requireAuth);

/** Challenge for a resource (no pay). */
x402Router.get("/challenge", async (req, res) => {
  const resource =
    typeof req.query.resource === "string"
      ? req.query.resource
      : "/stock/demo";
  const requirements = await buildPaymentRequirements(
    resource,
    "ShelfSign attested stock query",
  );
  res.json({
    x402Version: 2,
    accepts: [requirements],
    resource,
  });
});

/**
 * Sign a payment with the server agent wallet (Hedera ECDSA).
 * Prefer browser signing (frontend x402Client) for buyer UX.
 * Keep this for agents, scripts, and integration tests using HEDERA_AGENT_*.
 */
x402Router.post("/sign", async (req: AuthedRequest, res) => {
  try {
    const resource =
      typeof req.body?.resource === "string" ? req.body.resource : null;
    if (!resource) {
      res.status(400).json({ error: "resource_required" });
      return;
    }
    const requirements = await buildPaymentRequirements(
      resource,
      typeof req.body?.description === "string"
        ? req.body.description
        : "ShelfSign attested stock query",
    );
    const signed = await signExactPayment(requirements);
    res.json({
      x402Version: 2,
      requirements,
      paymentSignature: signed.paymentHeader,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string; detail?: string };
    res.status(e.status ?? 500).json({
      error: e.message ?? "sign_failed",
      detail: e.detail,
    });
  }
});

/**
 * One-shot unlock via server agent (HEDERA_AGENT_*).
 * Buyer UI signs in the browser instead; this remains for tests / agent demos.
 */
x402Router.post("/unlock", async (req: AuthedRequest, res) => {
  try {
    const resource =
      typeof req.body?.resource === "string" ? req.body.resource : null;
    const warehouseId =
      typeof req.body?.warehouseId === "string" ? req.body.warehouseId : null;
    const sku = typeof req.body?.sku === "string" ? req.body.sku : null;
    if (!resource && !(warehouseId && sku)) {
      res.status(400).json({ error: "resource_or_warehouse_sku_required" });
      return;
    }
    const path =
      resource ??
      `/stock/${warehouseId}/${encodeURIComponent(sku as string)}`;

    const requirements = await buildPaymentRequirements(
      path,
      "ShelfSign attested stock query (declared qty + camera proof)",
    );
    const signed = await signExactPayment(requirements);

    const publicApi =
      process.env.PUBLIC_API_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 4000}`;
    const auth = req.headers.authorization;
    const stockRes = await fetch(`${publicApi}${path}`, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        "PAYMENT-SIGNATURE": signed.paymentHeader,
      },
      signal: AbortSignal.timeout(90_000),
    });
    const stockBody = await stockRes.json().catch(() => null);
    if (!stockRes.ok) {
      res.status(stockRes.status).json({
        error: "stock_fetch_failed",
        detail: stockBody,
        requirements,
      });
      return;
    }

    res.json(stockBody);
  } catch (err) {
    const e = err as { status?: number; message?: string; detail?: string };
    res.status(e.status ?? 500).json({
      error: e.message ?? "unlock_failed",
      detail: e.detail,
    });
  }
});
