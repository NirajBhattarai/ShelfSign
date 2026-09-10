import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn(
    "[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — API routes that hit the DB will fail until set in backend/.env",
  );
}

// Service-role client: bypasses RLS. Only ever used server-side.
// Placeholder URL keeps the process bootable for /health when env is incomplete.
export const supabase: SupabaseClient = createClient(
  supabaseUrl || "http://127.0.0.1:54321",
  supabaseServiceRoleKey || "missing-service-role-key",
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);
