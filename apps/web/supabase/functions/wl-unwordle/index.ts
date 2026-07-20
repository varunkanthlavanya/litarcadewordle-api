// Port of apps/api/src/modules/unwordle/{uw.routes,uw.service,uw.repo,uw.sockets}.ts
//
// Path layout mirrors wl-timed-wordle: wl-unwordle/admin/<eventId>/... and
// wl-unwordle/player/<eventId>/.... The admin/player actions that used to be
// Socket.IO-only (session start/end/endAll, row submit, exit) are now plain
// POST endpoints; UNWORDLE has no per-try timer so there's no reconcile step
// needed here at all — just direct read-mutate-write per action.
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, requirePlayer, AuthError } from "../_shared/auth.ts";
import { writeAuditEntry } from "../_shared/audit.ts";
import { isValidGuessWord } from "../_shared/dictionary/index.ts";
import { VALID_GUESS_WORDS } from "../_shared/dictionary/validGuesses.ts";
import {
  adminEndSession,
  adminStartSession,
  playerExitSession,
  submitWord,
  type UnwordleSession,
  type UnwordleRowState,
} from "../_shared/unwordle/stateMachine.ts";
import { compareUnwordleSessions, isRankable } from "../_shared/unwordle/scoring.ts";
import { checkRowSatisfiability, validatePuzzlePatterns } from "../_shared/unwordle/puzzleValidator.ts";
import type { TileColor } from "../_shared/unwordle/validation.ts";

const ROWS_PER_PUZZLE = 4;
const ROW_LENGTH = 5;

function isValidPattern(pattern: unknown): pattern is TileColor[] {
  return Array.isArray(pattern) && pattern.length === ROW_LENGTH && pattern.every((c) => c === "GREEN" || c === "YELLOW" || c === "GRAY");
}

interface SessionRow {
  id: number;
  puzzle_id: number;
  event_player_id: number;
  status: UnwordleSession["status"];
  start_time: string | null;
  stop_time: string | null;
  rows_solved_count: number;
  total_time_ms: number;
  total_attempts: number;
  total_invalid_submissions: number;
  excluded_from_leaderboard: boolean;
  row_version: number;
}
interface RowRow {
  id: number;
  session_id: number;
  row_index: number;
  solved: boolean;
  solved_word: string | null;
  solved_at: string | null;
  attempts: number;
  invalid_submissions: number;
}

function hydrateSession(sessionRow: SessionRow, rowRows: RowRow[], solution: string, rowPatterns: TileColor[][]): UnwordleSession {
  return {
    solution: solution.toUpperCase(),
    status: sessionRow.status,
    startTime: sessionRow.start_time ? new Date(sessionRow.start_time).getTime() : null,
    stopTime: sessionRow.stop_time ? new Date(sessionRow.stop_time).getTime() : null,
    rows: rowRows.map((r) => ({
      rowIndex: r.row_index,
      pattern: rowPatterns[r.row_index],
      solved: r.solved,
      solvedWord: r.solved_word,
      solvedAt: r.solved_at ? new Date(r.solved_at).getTime() : null,
      attempts: r.attempts,
      invalidSubmissions: r.invalid_submissions,
    })),
    rowsSolvedCount: sessionRow.rows_solved_count,
    totalTimeMs: sessionRow.total_time_ms,
    totalAttempts: sessionRow.total_attempts,
    totalInvalidSubmissions: sessionRow.total_invalid_submissions,
    excludedFromLeaderboard: sessionRow.excluded_from_leaderboard,
  };
}

async function loadSessionAndPuzzle(db: ReturnType<typeof supabaseAdmin>, sessionId: number) {
  const { data: sessionRow } = await db.from("wl_unwordle_sessions").select("*").eq("id", sessionId).maybeSingle<SessionRow>();
  if (!sessionRow) return null;
  const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("*").eq("id", sessionRow.puzzle_id).maybeSingle();
  if (!puzzle) return null;
  const { data: rowRows } = await db.from("wl_unwordle_rows").select("*").eq("session_id", sessionId).order("row_index");
  const state = hydrateSession(sessionRow, (rowRows ?? []) as RowRow[], puzzle.solution_word, puzzle.row_patterns);
  return { sessionRow, puzzle, state };
}

async function persistSession(db: ReturnType<typeof supabaseAdmin>, sessionId: number, expectedRowVersion: number, state: UnwordleSession): Promise<boolean> {
  const { data: updated, error } = await db
    .from("wl_unwordle_sessions")
    .update({
      status: state.status,
      start_time: state.startTime !== null ? new Date(state.startTime).toISOString() : null,
      stop_time: state.stopTime !== null ? new Date(state.stopTime).toISOString() : null,
      rows_solved_count: state.rowsSolvedCount,
      total_time_ms: state.totalTimeMs,
      total_attempts: state.totalAttempts,
      total_invalid_submissions: state.totalInvalidSubmissions,
      excluded_from_leaderboard: state.excludedFromLeaderboard,
      last_activity_at: new Date().toISOString(),
      row_version: expectedRowVersion + 1,
    })
    .eq("id", sessionId)
    .eq("row_version", expectedRowVersion)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return !!updated;
}

async function persistRow(db: ReturnType<typeof supabaseAdmin>, sessionId: number, row: UnwordleRowState): Promise<number> {
  const { data, error } = await db
    .from("wl_unwordle_rows")
    .update({
      solved: row.solved,
      solved_word: row.solvedWord,
      solved_at: row.solvedAt !== null ? new Date(row.solvedAt).toISOString() : null,
      attempts: row.attempts,
      invalid_submissions: row.invalidSubmissions,
    })
    .eq("session_id", sessionId)
    .eq("row_index", row.rowIndex)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function buildEndedPayload(sessionId: number, reason: "completed" | "admin_ended", session: UnwordleSession) {
  return {
    sessionId,
    reason,
    revealedAnswers: session.rows.map((r) => {
      if (r.solvedWord) return r.solvedWord;
      return checkRowSatisfiability(session.solution, r.pattern, VALID_GUESS_WORDS, 1).sampleWords[0] ?? "";
    }),
    summary: {
      rowsSolvedCount: session.rowsSolvedCount,
      totalTimeMs: session.totalTimeMs,
      totalAttempts: session.totalAttempts,
      totalInvalidSubmissions: session.totalInvalidSubmissions,
    },
    rows: session.rows,
  };
}

function toStateDto(state: UnwordleSession) {
  return {
    status: state.status,
    startTime: state.startTime,
    rows: state.rows,
    rowsSolvedCount: state.rowsSolvedCount,
    totalTimeMs: state.totalTimeMs,
    totalAttempts: state.totalAttempts,
    totalInvalidSubmissions: state.totalInvalidSubmissions,
  };
}

async function getLeaderboard(db: ReturnType<typeof supabaseAdmin>, puzzleId: number) {
  const { data: sessions } = await db
    .from("wl_unwordle_sessions")
    .select("*, wl_event_players(display_name)")
    .eq("puzzle_id", puzzleId);
  const rankable = (sessions ?? [])
    .filter((s) => isRankable(s.status))
    .map((s) => ({
      id: s.id,
      eventPlayerId: s.event_player_id,
      displayName: (s.wl_event_players as { display_name: string | null } | null)?.display_name ?? null,
      rowsSolvedCount: s.rows_solved_count,
      totalTimeMs: s.total_time_ms,
      totalAttempts: s.total_attempts,
      totalInvalidSubmissions: s.total_invalid_submissions,
    }));
  rankable.sort(compareUnwordleSessions);
  return rankable.map((r, index) => ({
    sessionId: r.id,
    eventPlayerId: r.eventPlayerId,
    displayName: r.displayName,
    rowsSolvedCount: r.rowsSolvedCount,
    totalTimeMs: r.totalTimeMs,
    totalAttempts: r.totalAttempts,
    totalInvalidSubmissions: r.totalInvalidSubmissions,
    rank: index + 1,
  }));
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const rest = segments.slice(1); // drop "wl-unwordle"
  const audience = rest[0];
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
        const solutionWord = typeof body.solutionWord === "string" ? body.solutionWord.trim() : "";
        const rowPatterns = body.rowPatterns;
        if (solutionWord.length !== 5) return json(req, { error: "Solution word must be exactly 5 letters" }, 400);
        if (!isValidGuessWord(solutionWord)) return json(req, { error: "Solution word must be a real dictionary word" }, 400);
        if (!Array.isArray(rowPatterns) || rowPatterns.length !== ROWS_PER_PUZZLE || !rowPatterns.every(isValidPattern)) {
          return json(req, { error: `Exactly ${ROWS_PER_PUZZLE} row patterns of ${ROW_LENGTH} tiles each are required` }, 400);
        }

        const validation = validatePuzzlePatterns(solutionWord, rowPatterns, VALID_GUESS_WORDS);
        if (!validation.valid) {
          const badRows = validation.rowResults.filter((r) => !r.satisfiable).map((r) => r.rowIndex + 1);
          return json(req, { error: `Row(s) ${badRows.join(", ")} have no valid word satisfying that pattern` }, 400);
        }

        // Upsert by event_id rather than a bare insert: a second submission
        // (editing an already-created puzzle) must update the existing row,
        // not create a duplicate — wl_unwordle_sessions rows already created
        // for advanced players are tied to this puzzle_id, and a duplicate
        // puzzle row would break every player's status lookup (.maybeSingle()
        // errors on more than one match).
        const { data: existing } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();

        const { data: puzzle, error } = existing
          ? await db
              .from("wl_unwordle_puzzles")
              .update({ solution_word: solutionWord.toUpperCase(), row_patterns: rowPatterns })
              .eq("id", existing.id)
              .select("*")
              .single()
          : await db
              .from("wl_unwordle_puzzles")
              .insert({ event_id: eventId, solution_word: solutionWord.toUpperCase(), row_patterns: rowPatterns })
              .select("*")
              .single();
        if (error) return json(req, { error: error.message }, 400);

        await writeAuditEntry(db, {
          adminLabel: admin.nameLabel,
          eventId,
          actionType: existing ? "UNWORDLE_PUZZLE_UPDATED" : "UNWORDLE_PUZZLE_CREATED",
          targetType: "unwordle_puzzle",
          targetIds: [puzzle.id],
        });
        return json(req, { puzzle, validation }, existing ? 200 : 201);
      }

      if (action === "puzzle" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("*").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No UNWORDLE puzzle exists for this event yet" }, 404);
        return json(req, puzzle);
      }

      if (action === "puzzle/validate" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (typeof body.solutionWord !== "string" || !Array.isArray(body.rowPatterns) || body.rowPatterns.length !== ROWS_PER_PUZZLE) {
          return json(req, { error: "solutionWord (5 letters) and 4 row patterns of 5 tiles each are required" }, 400);
        }
        return json(req, validatePuzzlePatterns(body.solutionWord, body.rowPatterns, VALID_GUESS_WORDS));
      }

      if (action === "puzzle/status" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (!["DRAFT", "PUBLISHED"].includes(body.status)) return json(req, { error: "status must be DRAFT or PUBLISHED" }, 400);
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No UNWORDLE puzzle exists for this event yet" }, 404);

        await db.from("wl_unwordle_puzzles").update({ status: body.status }).eq("id", puzzle.id);
        await writeAuditEntry(db, { adminLabel: admin.nameLabel, eventId, actionType: `UNWORDLE_PUZZLE_${body.status}`, targetType: "unwordle_puzzle", targetIds: [puzzle.id] });
        return json(req, { ok: true });
      }

      if (action === "sessions" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, []);

        const { data: rows } = await db
          .from("wl_unwordle_sessions")
          .select("*, wl_event_players(display_name, mobile_number)")
          .eq("puzzle_id", puzzle.id)
          .order("event_player_id");

        const now = Date.now();
        const entries = (rows ?? []).map((r) => ({
          eventPlayerId: r.event_player_id,
          displayName: r.wl_event_players?.display_name ?? null,
          mobileNumber: r.wl_event_players?.mobile_number ?? "",
          sessionId: r.id,
          status: r.status,
          rowsSolvedCount: r.rows_solved_count,
          elapsedMs: r.status === "IN_PROGRESS" && r.start_time ? now - new Date(r.start_time).getTime() : r.total_time_ms,
          totalAttempts: r.total_attempts,
        }));
        return json(req, entries);
      }

      if (action === "sessions" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const eventPlayerIds: number[] = Array.isArray(body.eventPlayerIds) ? body.eventPlayerIds : [];
        if (eventPlayerIds.length === 0) return json(req, { error: "eventPlayerIds array is required" }, 400);
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id, solution_word, row_patterns").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No UNWORDLE puzzle exists for this event yet" }, 404);

        // A row whose given pattern is entirely GREEN has no ambiguity to
        // guess (see wl_confirm_cutoff for the same logic) — auto-solve it
        // as a freebie reveal rather than making the player type in
        // something the pattern itself already gave away.
        const rowPatterns = puzzle.row_patterns as TileColor[][];
        const freebieRows = rowPatterns.map((pattern) => pattern.every((c) => c === "GREEN"));
        const freebieCount = freebieRows.filter(Boolean).length;

        const sessions = [];
        for (const eventPlayerId of eventPlayerIds) {
          let { data: row } = await db.from("wl_unwordle_sessions").select("*").eq("puzzle_id", puzzle.id).eq("event_player_id", eventPlayerId).maybeSingle();
          if (!row) {
            const { data: inserted, error } = await db
              .from("wl_unwordle_sessions")
              .insert({ puzzle_id: puzzle.id, event_player_id: eventPlayerId, rows_solved_count: freebieCount })
              .select("*")
              .single();
            if (error) throw error;
            row = inserted;
            await db.from("wl_unwordle_rows").insert(
              Array.from({ length: ROWS_PER_PUZZLE }, (_, rowIndex) => ({
                session_id: row!.id,
                row_index: rowIndex,
                solved: freebieRows[rowIndex],
                solved_word: freebieRows[rowIndex] ? puzzle.solution_word : null,
              }))
            );
          }
          sessions.push(row);
        }
        return json(req, { sessions });
      }

      if (action === "leaderboard" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No UNWORDLE puzzle exists for this event yet" }, 404);
        return json(req, await getLeaderboard(db, puzzle.id));
      }

      if (action === "session/start" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const loaded = await loadSessionAndPuzzle(db, sessionId);
        if (!loaded) return json(req, { error: "Session not found" }, 404);

        const started = adminStartSession(loaded.state, Date.now());
        await persistSession(db, sessionId, loaded.sessionRow.row_version, started);
        await writeAuditEntry(db, { adminLabel: admin.nameLabel, eventId, actionType: "UNWORDLE_SESSION_STARTED", targetType: "unwordle_session", targetIds: [sessionId] });
        return json(req, { ok: true, state: toStateDto(started) });
      }

      if (action === "session/startAll" && req.method === "POST") {
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No UNWORDLE puzzle exists for this event yet" }, 404);

        const { data: sessions } = await db.from("wl_unwordle_sessions").select("id").eq("puzzle_id", puzzle.id).eq("status", "NOT_STARTED");
        let count = 0;
        const startedIds: number[] = [];
        for (const s of sessions ?? []) {
          const loaded = await loadSessionAndPuzzle(db, s.id);
          if (!loaded || loaded.state.status !== "NOT_STARTED") continue;
          const started = adminStartSession(loaded.state, Date.now());
          const ok = await persistSession(db, s.id, loaded.sessionRow.row_version, started);
          if (ok) {
            count++;
            startedIds.push(s.id);
          }
        }
        await writeAuditEntry(db, { adminLabel: admin.nameLabel, eventId, actionType: "UNWORDLE_SESSION_STARTED", targetType: "unwordle_session", targetIds: startedIds, reason: "Bulk start — start Playoffs for everyone", metadata: { count } });
        return json(req, { ok: true, count });
      }

      if (action === "session/end" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const loaded = await loadSessionAndPuzzle(db, sessionId);
        if (!loaded) return json(req, { error: "Session not found" }, 404);
        if (loaded.state.status !== "IN_PROGRESS") return json(req, { ok: true });

        const ended = adminEndSession(loaded.state, Date.now());
        await persistSession(db, sessionId, loaded.sessionRow.row_version, ended);
        await writeAuditEntry(db, { adminLabel: admin.nameLabel, eventId, actionType: "UNWORDLE_SESSION_ENDED", targetType: "unwordle_session", targetIds: [sessionId], reason: body.reason });
        return json(req, { ok: true, ended: buildEndedPayload(sessionId, "admin_ended", ended) });
      }

      if (action === "session/endAll" && req.method === "POST") {
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No UNWORDLE puzzle exists for this event yet" }, 404);

        const { data: sessions } = await db.from("wl_unwordle_sessions").select("id").eq("puzzle_id", puzzle.id).eq("status", "IN_PROGRESS");
        let count = 0;
        for (const s of sessions ?? []) {
          const loaded = await loadSessionAndPuzzle(db, s.id);
          if (!loaded || loaded.state.status !== "IN_PROGRESS") continue;
          const ended = adminEndSession(loaded.state, Date.now());
          const ok = await persistSession(db, s.id, loaded.sessionRow.row_version, ended);
          if (ok) count++;
        }
        await writeAuditEntry(db, { adminLabel: admin.nameLabel, eventId, actionType: "UNWORDLE_SESSION_ENDED", targetType: "unwordle_session", reason: "Bulk end — end game for everyone", metadata: { count } });
        return json(req, { ok: true, count });
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
        const { data: event } = await db.from("wl_events").select("name").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);

        const notAFinalist = { eventName: event.name, isFinalist: false, sessionId: null, sessionStatus: null, state: null, ended: null, allFinalistsDone: false };

        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("*").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, notAFinalist);

        const { data: sessionRow } = await db.from("wl_unwordle_sessions").select("*").eq("puzzle_id", puzzle.id).eq("event_player_id", player.eventPlayerId).maybeSingle<SessionRow>();
        if (!sessionRow) return json(req, notAFinalist);

        const { data: rowRows } = await db.from("wl_unwordle_rows").select("*").eq("session_id", sessionRow.id).order("row_index");
        const state = hydrateSession(sessionRow, (rowRows ?? []) as RowRow[], puzzle.solution_word, puzzle.row_patterns);

        // A finalist's own session can finish long before every other
        // finalist has — rank/leaderboard stays hidden (see `allFinalistsDone`
        // in the shared type) until every session tied to this puzzle has
        // reached a terminal state, not just this player's own.
        const { data: allSessions } = await db.from("wl_unwordle_sessions").select("status").eq("puzzle_id", puzzle.id);
        const sessions = allSessions ?? [];
        const allFinalistsDone = sessions.length > 0 && sessions.every((s) => s.status === "COMPLETED" || s.status === "ENDED" || s.status === "EXITED");

        if (sessionRow.status === "COMPLETED" || sessionRow.status === "ENDED") {
          return json(req, {
            eventName: event.name,
            isFinalist: true,
            sessionId: sessionRow.id,
            sessionStatus: sessionRow.status,
            state: null,
            ended: buildEndedPayload(sessionRow.id, sessionRow.status === "COMPLETED" ? "completed" : "admin_ended", state),
            allFinalistsDone,
          });
        }

        return json(req, { eventName: event.name, isFinalist: true, sessionId: sessionRow.id, sessionStatus: sessionRow.status, state: toStateDto(state), ended: null, allFinalistsDone });
      }

      if (action === "leaderboard" && req.method === "GET") {
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!puzzle) return json(req, { error: "No UNWORDLE puzzle exists for this event yet" }, 404);
        return json(req, await getLeaderboard(db, puzzle.id));
      }

      if (action === "row/submit" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const rowIndex = Number(body.rowIndex);
        const guess = typeof body.guess === "string" ? body.guess : "";
        if (rowIndex < 0 || rowIndex >= ROWS_PER_PUZZLE) return json(req, { error: "Invalid row index" }, 400);

        const loaded = await loadSessionAndPuzzle(db, sessionId);
        if (!loaded) return json(req, { error: "Session not found" }, 404);

        try {
          const { session, outcome } = submitWord(loaded.state, rowIndex, guess, Date.now(), isValidGuessWord);
          const ok = await persistSession(db, sessionId, loaded.sessionRow.row_version, session);
          if (!ok) return json(req, { error: "Could not persist guess — please retry" }, 409);

          const rowDbId = await persistRow(db, sessionId, session.rows[rowIndex]);
          await db.from("wl_unwordle_row_attempts").insert({
            row_id: rowDbId,
            guess_word: guess.toUpperCase(),
            is_valid_word: outcome.kind !== "REJECTED_INVALID_WORD",
            satisfies_tiles: outcome.kind === "ACCEPTED",
            failed_tile_reasons: outcome.kind === "REJECTED_TILE_MISMATCH" ? outcome.failedTiles : [],
          });

          return json(req, { outcome, state: toStateDto(session) });
        } catch (err) {
          return json(req, { error: err instanceof Error ? err.message : "Failed to submit guess" }, 400);
        }
      }

      if (action === "exit" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const loaded = await loadSessionAndPuzzle(db, sessionId);
        if (!loaded) return json(req, { error: "Session not found" }, 404);

        try {
          const exited = playerExitSession(loaded.state, Date.now());
          const ok = await persistSession(db, sessionId, loaded.sessionRow.row_version, exited);
          if (!ok) return json(req, { error: "Could not persist exit — please retry" }, 409);
          return json(req, { ok: true });
        } catch (err) {
          return json(req, { error: err instanceof Error ? err.message : "Failed to exit" }, 400);
        }
      }

      return json(req, { error: "Not found" }, 404);
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-unwordle error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
