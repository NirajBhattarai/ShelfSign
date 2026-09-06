import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../services/supabase.js";

export const categoryRouter = Router();

categoryRouter.use(requireAuth);

// Canonical category list. Suppliers tag warehouses from this list rather
// than typing free text, so buyer-side filtering stays meaningful.
categoryRouter.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");
  if (error) {
    res.status(500).json({ error: "query_failed" });
    return;
  }
  res.json(data);
});
