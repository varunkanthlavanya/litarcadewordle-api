// Cron-invoked safety net (see the migration's pg_cron schedule) — reconciles
// every IN_PROGRESS Timed Wordle session against its stored deadlines, same
// as loadAndReconcile does on-demand for an active player's own polling.
// Exists for sessions nobody is actively polling (an abandoned tab): without
// this, such a session would just sit stale in the DB past its real deadline
// until someone happens to look at it. UNWORDLE needs no equivalent sweep —
// it has no per-try timer, only an admin-driven start/stop stopwatch.
import { json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { loadAndReconcile } from "../_shared/timedWordle/repo.ts";

Deno.serve(async (req) => {
  // Invoked only by pg_cron, which sends a dedicated x-cron-secret header
  // (see the pg_cron migration) — deliberately NOT the service-role key,
  // since that key would otherwise have to be baked as a literal string into
  // a migration file that gets committed to git (the host project's own
  // migrations avoid this same trap for their cron jobs).
  const provided = req.headers.get("x-cron-secret") ?? "";
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || provided !== expected) return json(req, { error: "Forbidden" }, 403);

  const db = supabaseAdmin();
  const now = Date.now();

  const { data: sessions, error } = await db.from("wl_timed_wordle_sessions").select("id").eq("status", "IN_PROGRESS");
  if (error) return json(req, { error: error.message }, 500);

  let reconciled = 0;
  for (const s of sessions ?? []) {
    try {
      await loadAndReconcile(db, s.id, now);
      reconciled++;
    } catch (err) {
      console.error(`wl-sweep: failed to reconcile session ${s.id}`, err);
    }
  }

  return json(req, { ok: true, scanned: sessions?.length ?? 0, reconciled });
});
