import { createClient } from "jsr:@supabase/supabase-js@2";

/** Service-role client for use inside edge functions only — bypasses RLS,
 * which is exactly why every wl_* table has RLS enabled with zero policies:
 * this is the only thing that can read/write them, after this module's own
 * bearer-token check runs (see requireAdmin/requirePlayer in this folder). */
export function supabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}
