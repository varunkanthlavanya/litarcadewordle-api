// Port of apps/api/src/modules/timed-wordle/{tw.routes,tw.service,tw.repo,tw.sockets}.ts
//
// Path layout: wl-timed-wordle/admin/<eventId>/... and wl-timed-wordle/player/<eventId>/...
// The admin-only actions that used to be Socket.IO-only (session end/bulkEnd,
// clock adjust) and the player-only actions that used to be Socket.IO-only
// (game start, guess submit) are now plain POST endpoints here — everything
// else keeps the same REST shape tw.routes.ts already had.
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, requirePlayer, AuthError } from "../_shared/auth.ts";
import { writeAuditEntry } from "../_shared/audit.ts";
import { isValidGuessWord } from "../_shared/dictionary/index.ts";
import { startSession, applyGuess, adminEndSession, adjustGlobalDeadline, adjustCurrentTryDeadline, InvalidTransitionError, type TimedWordleSession } from "../_shared/timedWordle/stateMachine.ts";
import { compareTimedWordleSessions } from "../_shared/timedWordle/scoring.ts";
import { hydrateSession, loadAndReconcile, persistSessionAndNewTries, type TimedWordleSessionRow } from "../_shared/timedWordle/repo.ts";

const ONLINE_WINDOW_MS = 60_000;
const ROUND_CLOSE_BUFFER_MS = 6 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["FOUND", "NOT_FOUND_TRIES", "NOT_FOUND_TIME", "ADMIN_ENDED"]);

function mapStatusToEndReason(status: string): "solved" | "tries_exhausted" | "time_expired" | "admin_forced" | "unknown" {
  switch (status) {
    case "FOUND": return "solved";
    case "NOT_FOUND_TRIES": return "tries_exhausted";
    case "NOT_FOUND_TIME": return "time_expired";
    case "ADMIN_ENDED": return "admin_forced";
    default: return "unknown";
  }
}

function serializeState(state: TimedWordleSession) {
  return {
    status: state.status,
    currentTryNumber: state.currentTryNumber,
    currentTryDeadlineAt: state.currentTryDeadlineAt,
    graceActive: state.graceActive,
    graceDeadlineAt: state.graceDeadlineAt,
    globalDeadlineAt: state.globalDeadlineAt,
    bankedSurplusMs: state.bankedSurplusMs,
    tries: state.tries,
    found: state.found,
    cumulativeTimeMs: state.cumulativeTimeMs,
    triesUsed: state.triesUsed,
    tileScore: state.tileScore,
  };
}

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
  const rest = segments.slice(1); // drop "wl-timed-wordle"
  const audience = rest[0]; // "admin" | "player"
  const db = supabaseAdmin();

  try {
    // ============================= ADMIN =============================
    if (audience === "admin") {
      const admin = await requireAdmin(req);
      const eventId = Number(rest[1]);
      if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);
      const action = rest.slice(2).join("/");

      if (action === "puzzle" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const secretWord = typeof body.secretWord === "string" ? body.secretWord.trim() : "";
        if (secretWord.length !== 5) return json(req, { error: "secretWord (5 letters) is required" }, 400);
        if (!isValidGuessWord(secretWord)) return json(req, { error: "Secret word must be a real dictionary word" }, 400);

        const { data: puzzle, error } = await db
          .from("wl_timed_wordle_puzzles")
          .insert({ event_id: eventId, secret_word: secretWord.toUpperCase(), definition: body.definition ?? null })
          .select("*")
          .single();
        if (error) return json(req, { error: error.message }, 400);

        await writeAuditEntry(db, { adminLabel: admin.nameLabel, eventId, actionType: "TIMED_WORDLE_PUZZLE_CREATED", targetType: "timed_wordle_puzzle", targetIds: [puzzle.id] });
        return json(req, puzzle, 201);
      }

      if (action === "puzzle" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("*").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No Timed Wordle puzzle exists for this event yet" }, 404);
        return json(req, puzzle);
      }

      if (action === "puzzle/status" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (!["SCHEDULED", "OPEN", "CLOSED"].includes(body.status)) {
          return json(req, { error: "status must be SCHEDULED, OPEN, or CLOSED" }, 400);
        }
        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No Timed Wordle puzzle exists for this event yet" }, 404);

        await db.from("wl_timed_wordle_puzzles").update({ status: body.status }).eq("id", puzzle.id);
        if (body.status === "OPEN") await db.from("wl_events").update({ status: "PRELIMS_LIVE" }).eq("id", eventId);
        if (body.status === "CLOSED") await db.from("wl_events").update({ status: "PRELIMS_CLOSED" }).eq("id", eventId);

        await writeAuditEntry(db, { adminLabel: admin.nameLabel, eventId, actionType: `TIMED_WORDLE_PUZZLE_${body.status}`, targetType: "timed_wordle_puzzle", targetIds: [puzzle.id] });
        return json(req, { ok: true });
      }

      if (action === "leaderboard" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No Timed Wordle puzzle exists for this event yet" }, 404);
        return json(req, await getLeaderboard(db, puzzle.id));
      }

      if (action === "sessions" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, []);

        const { data: cohort } = await db.from("wl_event_players").select("id, display_name, mobile_number").eq("event_id", eventId).order("id");
        const { data: sessions } = await db.from("wl_timed_wordle_sessions").select("*").eq("puzzle_id", puzzle.id);
        const sessionByPlayer = new Map((sessions ?? []).map((s) => [s.event_player_id, s]));
        const since = Date.now() - ONLINE_WINDOW_MS;

        const entries = (cohort ?? []).map((p) => {
          const s = sessionByPlayer.get(p.id);
          let playerState: "IDLE" | "IN_GAME" | "POST_GAME" = "IDLE";
          let elapsedMs: number | null = null;
          if (s?.status === "IN_PROGRESS") {
            playerState = "IN_GAME";
            elapsedMs = s.session_started_at ? Date.now() - new Date(s.session_started_at).getTime() : null;
          } else if (s?.status && TERMINAL_STATUSES.has(s.status)) {
            playerState = "POST_GAME";
            elapsedMs = s.cumulative_time_ms ?? null;
          }
          const online = !!(s?.last_activity_at && new Date(s.last_activity_at).getTime() >= since);
          return {
            eventPlayerId: p.id,
            displayName: p.display_name,
            mobileNumber: p.mobile_number,
            online,
            playerState,
            sessionId: s?.id ?? null,
            currentTryNumber: s?.status === "IN_PROGRESS" ? s.current_try_number : null,
            elapsedMs,
            lastActivityAt: s?.last_activity_at ?? null,
          };
        });
        return json(req, entries);
      }

      if (action === "session/end" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const now = Date.now();
        const loaded = await loadAndReconcile(db, sessionId, now);
        if (!loaded || loaded.state.status !== "IN_PROGRESS") return json(req, { error: "Session is not active" }, 400);

        const triesBefore = loaded.state.tries.length;
        const ended = adminEndSession(loaded.state, now);
        await persistSessionAndNewTries(db, sessionId, loaded.row.row_version, ended, triesBefore);

        await writeAuditEntry(db, { adminLabel: admin.nameLabel, actionType: "TIMED_WORDLE_SESSION_ENDED", targetType: "timed_wordle_session", targetIds: [sessionId], reason: body.reason, metadata: { finalStatus: ended.status } });
        return json(req, { ok: true });
      }

      if (action === "session/bulkEnd" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionIds: number[] = Array.isArray(body.sessionIds) ? body.sessionIds : [];
        const now = Date.now();
        const succeeded: number[] = [];
        const failed: number[] = [];
        for (const sessionId of sessionIds) {
          try {
            const loaded = await loadAndReconcile(db, sessionId, now);
            if (!loaded || loaded.state.status !== "IN_PROGRESS") throw new Error("not active");
            const triesBefore = loaded.state.tries.length;
            const ended = adminEndSession(loaded.state, now);
            const ok = await persistSessionAndNewTries(db, sessionId, loaded.row.row_version, ended, triesBefore);
            if (!ok) throw new Error("conflict");
            succeeded.push(sessionId);
          } catch {
            failed.push(sessionId);
          }
        }
        await writeAuditEntry(db, { adminLabel: admin.nameLabel, actionType: "TIMED_WORDLE_BULK_SESSION_END", targetType: "timed_wordle_session", targetIds: sessionIds, reason: body.reason, metadata: { succeeded: succeeded.length, failed: failed.length } });
        return json(req, { ok: true, succeeded, failed });
      }

      if (action === "clock/adjust" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const deltaMs = Number(body.deltaSeconds) * 1000;
        const scope = body.scope === "GLOBAL" ? "GLOBAL" : "CURRENT_TRY";
        const now = Date.now();

        const loaded = await loadAndReconcile(db, sessionId, now);
        if (!loaded || loaded.state.status !== "IN_PROGRESS") return json(req, { error: "Session is not active" }, 400);

        const triesBefore = loaded.state.tries.length;
        const adjusted = scope === "GLOBAL" ? adjustGlobalDeadline(loaded.state, deltaMs) : adjustCurrentTryDeadline(loaded.state, deltaMs);
        await persistSessionAndNewTries(db, sessionId, loaded.row.row_version, adjusted, triesBefore);

        await db.from("wl_timer_adjustments").insert({ session_id: sessionId, admin_label: admin.nameLabel, scope, delta_ms: deltaMs, reason: body.reason ?? null });
        await db.from("wl_timed_wordle_sessions").update({ had_admin_clock_adjustment: true }).eq("id", sessionId);

        return json(req, { ok: true, state: serializeState(adjusted) });
      }

      return json(req, { error: "Not found" }, 404);
    }

    // ============================= PLAYER =============================
    if (audience === "player") {
      const player = await requirePlayer(req);
      const eventId = Number(rest[1]);
      if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);
      const action = rest.slice(2).join("/");

      if (action === "status" && req.method === "GET") {
        const { data: event } = await db.from("wl_events").select("*").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);

        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("*").eq("event_id", eventId).maybeSingle();
        const { data: sessionRow } = puzzle
          ? await db.from("wl_timed_wordle_sessions").select("*").eq("puzzle_id", puzzle.id).eq("event_player_id", player.eventPlayerId).maybeSingle()
          : { data: null };

        let result = null;
        if (puzzle && sessionRow && TERMINAL_STATUSES.has(sessionRow.status)) {
          result = {
            reason: mapStatusToEndReason(sessionRow.status),
            found: sessionRow.found,
            cumulativeTimeMs: sessionRow.cumulative_time_ms ?? 0,
            triesUsed: sessionRow.tries_used ?? 0,
            tileScore: sessionRow.tile_score ?? 0,
            secretWord: puzzle.secret_word,
            definition: puzzle.definition,
          };
        }

        return json(req, {
          eventName: event.name,
          roundStatus: puzzle?.status ?? "SCHEDULED",
          roundOpensAt: event.round_opens_at,
          roundClosesAt: event.round_closes_at,
          sessionStatus: sessionRow?.status ?? null,
          sessionId: sessionRow?.id ?? null,
          result,
        });
      }

      if (action === "leaderboard" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No Timed Wordle puzzle exists for this event yet" }, 404);
        return json(req, await getLeaderboard(db, puzzle.id));
      }

      if (action === "game/start" && req.method === "POST") {
        const now = Date.now();
        const { data: puzzle } = await db.from("wl_timed_wordle_puzzles").select("*").eq("event_id", eventId).maybeSingle();
        if (!puzzle || puzzle.status !== "OPEN") return json(req, { error: "Prelims round is not currently open" }, 400);

        const { data: event } = await db.from("wl_events").select("round_closes_at").eq("id", eventId).maybeSingle();
        if (event?.round_closes_at) {
          const closesAt = new Date(event.round_closes_at).getTime();
          if (now + ROUND_CLOSE_BUFFER_MS > closesAt) return json(req, { error: "Round closes too soon to start a new game — not enough time left" }, 400);
        }

        let { data: row } = await db
          .from("wl_timed_wordle_sessions")
          .select("*")
          .eq("puzzle_id", puzzle.id)
          .eq("event_player_id", player.eventPlayerId)
          .maybeSingle<TimedWordleSessionRow>();

        if (!row) {
          const { data: inserted, error } = await db
            .from("wl_timed_wordle_sessions")
            .insert({ puzzle_id: puzzle.id, event_player_id: player.eventPlayerId })
            .select("*")
            .single<TimedWordleSessionRow>();
          if (error) throw error;
          row = inserted;
        }

        if (row.status === "NOT_STARTED") {
          const state = startSession(puzzle.secret_word, now);
          await persistSessionAndNewTries(db, row.id, row.row_version, state, 0);
          return json(req, { sessionId: row.id, state: serializeState(state) });
        }

        const loaded = await loadAndReconcile(db, row.id, now);
        return json(req, { sessionId: row.id, state: loaded ? serializeState(loaded.state) : serializeState(hydrateSession(row, [], puzzle.secret_word)) });
      }

      if (action === "game/guess" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const guess = typeof body.guess === "string" ? body.guess : "";
        if (guess.length !== 5 || !/^[A-Za-z]+$/.test(guess)) return json(req, { error: "Guess must be exactly 5 letters" }, 400);

        const now = Date.now();
        const loaded = await loadAndReconcile(db, sessionId, now);
        if (!loaded) return json(req, { error: "Session not found" }, 404);
        if (loaded.state.status !== "IN_PROGRESS") return json(req, { error: `Cannot submit a guess for a session in status ${loaded.state.status}` }, 400);

        try {
          const triesBefore = loaded.state.tries.length;
          const { feedback, session } = applyGuess(loaded.state, guess, now);
          const ok = await persistSessionAndNewTries(db, sessionId, loaded.row.row_version, session, triesBefore);
          if (!ok) return json(req, { error: "Could not persist guess — please retry" }, 409);
          return json(req, { feedback, state: serializeState(session) });
        } catch (err) {
          if (err instanceof InvalidTransitionError) return json(req, { error: err.message }, 400);
          throw err;
        }
      }

      return json(req, { error: "Not found" }, 404);
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-timed-wordle error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
