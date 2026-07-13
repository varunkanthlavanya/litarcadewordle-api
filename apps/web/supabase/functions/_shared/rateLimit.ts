import { supabaseAdmin } from "./supabaseAdmin.ts";

/** DB-backed replacement for apps/api's in-memory createFixedWindowRateLimiter —
 * edge function invocations are stateless/ephemeral, so the limiter's counters
 * have to live somewhere durable. Same effective policy: reject once an IP has
 * hit maxAttempts within the trailing windowMs. */
export async function checkRateLimit(params: { ipAddress: string; windowMs: number; maxAttempts: number }): Promise<boolean> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - params.windowMs).toISOString();

  const { count } = await db
    .from("wl_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", params.ipAddress)
    .gte("attempted_at", since);

  await db.from("wl_login_attempts").insert({ ip_address: params.ipAddress });

  return (count ?? 0) < params.maxAttempts;
}
