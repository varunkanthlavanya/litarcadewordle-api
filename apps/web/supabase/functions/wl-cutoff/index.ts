// Port of apps/api/src/modules/cutoff/{cutoff.routes,cutoff.service}.ts
//
// Ranking stays in TypeScript (same compareTimedWordleSessions used
// everywhere else); the actual multi-table write (create UNWORDLE sessions,
// mark advanced, notify, update event status, audit log) is the
// wl_confirm_cutoff Postgres function from the schema migration, called via
// RPC so it's one atomic transaction.
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, AuthError } from "../_shared/auth.ts";
import { compareTimedWordleSessions } from "../_shared/timedWordle/scoring.ts";

async function getLeaderboard(db: ReturnType<typeof supabaseAdmin>, puzzleId: number) {
  const { data: rows } = await db
    .from("wl_timed_wordle_sessions")
    .select("id, event_player_id, found, cumulative_time_ms, tries_used, tile_score")
    .eq("puzzle_id", puzzleId)
    .in("status", ["FOUND", "NOT_FOUND_TRIES", "NOT_FOUND_TIME", "ADMIN_ENDED"]);

  const rankable = (rows ?? []).map((r) => ({
    id: r.id,
    found: r.found,
    cumulativeTimeMs: r.cumulative_time_ms ?? 0,
    triesUsed: r.tries_used ?? 0,
    tileScore: r.tile_score ?? 0,
    eventPlayerId: r.event_player_id,
  }));
  rankable.sort(compareTimedWordleSessions);

  return rankable.map((r, index) => ({
    sessionId: r.id,
    eventPlayerId: r.eventPlayerId,
    found: r.found,
    cumulativeTimeMs: r.cumulativeTimeMs,
    triesUsed: r.triesUsed,
    tileScore: r.tileScore,
    rank: index + 1,
  }));
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const eventId = Number(segments[1]);
  const action = segments.slice(2).join("/");
  const db = supabaseAdmin();

  try {
    const admin = await requireAdmin(req);
    if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);

    if (action === "preview" && req.method === "GET") {
      const topN = Number(url.searchParams.get("topN") ?? "20");
      const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
      if (!puzzle) return json(req, { error: "No Timed Wordle puzzle exists for this event yet" }, 400);

      const leaderboard = await getLeaderboard(db, puzzle.id);
      return json(req, leaderboard.map((e) => ({ ...e, withinCutoff: e.rank <= topN })));
    }

    if (action === "confirm" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const eventPlayerIds: number[] = Array.isArray(body.eventPlayerIds) ? body.eventPlayerIds : [];
      if (eventPlayerIds.length === 0) return json(req, { error: "eventPlayerIds array is required" }, 400);

      const { data: twPuzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
      if (!twPuzzle) return json(req, { error: "No Timed Wordle puzzle exists for this event yet" }, 400);
      const { data: uwPuzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
      if (!uwPuzzle) return json(req, { error: "Create the UNWORDLE puzzle before advancing players to Playoffs" }, 400);

      const leaderboard = await getLeaderboard(db, twPuzzle.id);
      const advancing = leaderboard.filter((e) => eventPlayerIds.includes(e.eventPlayerId));

      const { data: advancedCount, error } = await db.rpc("wl_confirm_cutoff", {
        p_event_id: eventId,
        p_admin_label: admin.nameLabel,
        p_advancing: advancing.map((e) => ({ sessionId: e.sessionId, eventPlayerId: e.eventPlayerId, rank: e.rank })),
      });
      if (error) return json(req, { error: error.message }, 400);

      return json(req, { advancedCount });
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-cutoff error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
