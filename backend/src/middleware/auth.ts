import type { NextFunction, Request, Response } from "express";
import { supabase } from "../services/supabase.js";

export type Role = "supplier" | "buyer";

export interface AuthedRequest extends Request {
  user?: { id: string; role: Role };
}

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    res.status(401).json({ error: "no_profile" });
    return;
  }

  req.user = { id: userData.user.id, role: profile.role as Role };
  next();
}
