import "dotenv/config";
import cors from "cors";
import express from "express";

import { nonceRouter } from "./routes/nonce.js";
import { attestationRouter } from "./routes/attestations.js";
import { stockRouter } from "./routes/stock.js";

const app = express();
const port = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/nonce", nonceRouter);
app.use("/attestations", attestationRouter);
app.use("/stock", stockRouter);

app.listen(port, () => {
  console.log(`ShelfSign backend listening on :${port}`);
});
