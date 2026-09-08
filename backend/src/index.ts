import "./loadEnv.js";
import cors from "cors";
import express from "express";

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
import { creRouter } from "./routes/cre.js";

const app = express();
const port = process.env.PORT ?? 4000;

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
app.use("/cre", creRouter);

app.listen(port, () => {
  console.log(`ShelfSign backend listening on :${port}`);
  console.log(
    `HCS topic: ${process.env.HEDERA_HCS_TOPIC_ID?.trim() || "(not configured)"}`,
  );
});
