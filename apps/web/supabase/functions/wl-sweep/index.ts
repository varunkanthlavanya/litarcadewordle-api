// Cron-invoked safety net (see the migration's pg_cron schedule) — reconciles
// every IN_PROGRESS Timed Wordle session against its stored deadlines, same
// as loadAndReconcile does on-demand for an active player's own polling.
// Exists for sessions nobody is actively polling (an abandoned tab): without
// this, such a session would just sit stale in the DB past its real deadline
// until someone happens to look at it.
//
// UNWORDLE Playoffs now has an equivalent need since the continuous-round
// mode (PRD/UNWORDLE_PLAYOFFS_ROUND_PRD.md, Rev 3) added a real round-level
// deadline (unwordle_round_ends_at) — a player who stops polling before the
// round auto-ends would otherwise sit IN_PROGRESS forever. Both passes share
// this one cron invocation/schedule rather than needing a second cron entry.
import { json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { loadAndReconcile } from "../_shared/timedWordle/repo.ts";
import { reconcileRoundForPlayer } from "../_shared/unwordle/roundRepo.ts";

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

  // ---- UNWORDLE Playoffs round-deadline sweep ----
  const { data: uwSessions, error: uwError } = await db
    .from("wl_unwordle_sessions")
    .select("id, event_player_id, puzzle_id")
    .eq("status", "IN_PROGRESS");
  if (uwError) return json(req, { error: uwError.message }, 500);

  let uwReconciled = 0;
  if (uwSessions && uwSessions.length > 0) {
    const puzzleIds = [...new Set(uwSessions.map((s) => s.puzzle_id))];
    const { data: puzzles } = await db.from("wl_unwordle_puzzles").select("id, event_id").in("id", puzzleIds);
    const eventIdByPuzzleId = new Map((puzzles ?? []).map((p) => [p.id, p.event_id]));

    const eventIds = [...new Set([...eventIdByPuzzleId.values()])];
    const { data: events } = await db.from("wl_events").select("id, status, unwordle_round_ends_at").in("id", eventIds);
    const eventById = new Map((events ?? []).map((e) => [e.id, e]));

    for (const s of uwSessions) {
      try {
        const eventId = eventIdByPuzzleId.get(s.puzzle_id);
        const event = eventId !== undefined ? eventById.get(eventId) : undefined;
        if (!event) continue;
        const { forcedEnd } = await reconcileRoundForPlayer(db, event, s.event_player_id, now);
        if (forcedEnd) uwReconciled++;
      } catch (err) {
        console.error(`wl-sweep: failed to reconcile UNWORDLE session ${s.id}`, err);
      }
    }
  }

  return json(req, {
    ok: true,
    scanned: sessions?.length ?? 0,
    reconciled,
    unwordleScanned: uwSessions?.length ?? 0,
    unwordleReconciled: uwReconciled,
  });
});
