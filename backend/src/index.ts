import "./loadEnv.js";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nonceRouter } from "./routes/nonce.js";
import { attestationRouter } from "./routes/attestations.js";
import { stockRouter } from "./routes/stock.js";
import { cameraRouter } from "./routes/cameras.js";
import { supplierRouter } from "./routes/suppliers.js";
import { orderRouter } from "./routes/orders.js";
import { categoryRouter } from "./routes/categories.js";
import { warehouseRouter } from "./routes/warehouses.js";
import { authRouter } from "./routes/auth.js";
import { x402Router } from "./routes/x402.js";

const app = express();
const port = process.env.PORT ?? 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Pitch assets (images/icons) mirrored from the Next public folder
const pitchDir = path.resolve(__dirname, "../../frontend/public/pitch");

app.use(cors());
// Raised from the default 100kb so a warehouse photo (sent as a base64
// data URL) fits in the request body.
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/hcs", (_req, res) => {
  const topic = process.env.HEDERA_HCS_TOPIC_ID?.trim() ?? "";
  const operator = process.env.HEDERA_OPERATOR_ID?.trim() ?? "";
  res.json({
    configured: Boolean(topic && operator && !topic.includes("mock")),
    topicId: topic || null,
    operatorId: operator || null,
  });
});

/** Pitch deck lives in the Next app at /pitch (no Reveal.js static HTML). */
app.get("/pitch/meta", (_req, res) => {
  const frontend =
    process.env.PUBLIC_FRONTEND_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";
  res.json({
    name: "ShelfSign Pitch",
    path: `${frontend}/pitch`,
    slides: 10,
    format: "next.js",
    tagline:
      "Camera-backed stock, signed from the silicon — attested with a live nonce.",
  });
});
app.get(["/pitch", "/pitch/"], (_req, res) => {
  const frontend =
    process.env.PUBLIC_FRONTEND_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";
  res.redirect(302, `${frontend}/pitch`);
});
app.use(
  "/pitch/assets",
  express.static(pitchDir + "/assets", {
    index: false,
    redirect: false,
  }),
);

app.use("/nonce", nonceRouter);
app.use("/attestations", attestationRouter);
app.use("/stock", stockRouter);
app.use("/x402", x402Router);
app.use("/cameras", cameraRouter);
app.use("/suppliers", supplierRouter);
app.use("/orders", orderRouter);
app.use("/categories", categoryRouter);
app.use("/warehouses", warehouseRouter);
app.use("/auth", authRouter);

// Vercel imports this module as a serverless function handler instead of
// binding a port, so only listen when running as a standalone process.
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`ShelfSign backend listening on :${port}`);
    console.log(
      `HCS topic: ${process.env.HEDERA_HCS_TOPIC_ID?.trim() || "(not configured)"}`,
    );
    console.log(
      `Pitch deck: ${process.env.PUBLIC_FRONTEND_URL || "http://localhost:3000"}/pitch`,
    );
  });
}

export default app;
