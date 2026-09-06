import { Router } from "express";
import { supabase } from "../services/supabase.js";

export const authRouter = Router();

// Step 1 of signup: just email + password. Goes through the admin API
// (service-role key) so the account is created pre-confirmed — no
// confirmation email, no waiting on Supabase's email rate limit, and no
// client session is required (there isn't one yet).
authRouter.post("/signup", async (req, res) => {
  const { email, password } = (req.body ?? {}) as {
    email?: string;
    password?: string;
  };
  if (!email?.trim() || !password || password.length < 6) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    res.status(400).json({ error: "signup_failed", details: error?.message });
    return;
  }

  res.status(201).json({ userId: data.user.id });
});

// Step 2: attach the profile (role + company name) once the account
// exists. Asked after account creation succeeds, not upfront — and
// still no session yet, so this goes through the service role too.
authRouter.post("/complete-profile", async (req, res) => {
  const { userId, role, companyName } = (req.body ?? {}) as {
    userId?: string;
    role?: string;
    companyName?: string;
  };

  if (
    !userId ||
    !companyName?.trim() ||
    (role !== "supplier" && role !== "buyer")
  ) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  const { error } = await supabase.from("profiles").insert({
    id: userId,
    role,
    company_name: companyName.trim(),
  });

  if (error) {
    res
      .status(500)
      .json({ error: "profile_create_failed", details: error.message });
    return;
  }

  res.status(201).json({ ok: true });
});
