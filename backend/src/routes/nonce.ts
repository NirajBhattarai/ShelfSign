import { Router } from "express";
import { issueNonce } from "../services/nonceStore.js";

export const nonceRouter = Router();

nonceRouter.post("/challenge", (_req, res) => {
  res.json(issueNonce());
});
