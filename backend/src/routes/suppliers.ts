import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";

export const supplierRouter = Router();

supplierRouter.use(requireAuth);

// Buyer browsing surface: list suppliers, optionally filtered by a
// category they declared themselves (free-form — see profiles.categories).
supplierRouter.get("/", async (req, res) => {
  const category =
    typeof req.query.category === "string" ? req.query.category : null;

  let query = supabase
    .from("profiles")
    .select("id, company_name, categories")
    .eq("role", "supplier");
  if (category) query = query.contains("categories", [category]);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});

// Latest attested stock for one supplier, newest first.
supplierRouter.get("/:id/stock", async (req, res) => {
  const { data, error } = await supabase
    .from("attestations")
    .select(
      "id, camera_account, nonce, image_hash, model, model_hash, items, captured_at",
    )
    .eq("supplier_id", req.params.id)
    .order("captured_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});
