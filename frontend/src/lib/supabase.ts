import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "missing-anon-key";

if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
) {
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing — auth and catalog will not work until set in frontend/.env.local",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Role = "supplier" | "buyer";

export interface Profile {
  id: string;
  role: Role;
  company_name: string;
  categories: string[];
}
