// Shared session load/hydrate/persist + round-lifecycle helpers for the
// UNWORDLE continuous-round mode (PRD/UNWORDLE_PLAYOFFS_ROUND_PRD.md, Rev 3).
// Mirrors the role _shared/timedWordle/repo.ts plays for Timed Wordle: the
// single place that knows how to load a session, reconcile it against a
// deadline, and persist it back with row-version optimistic concurrency.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { adminEndSession, type UnwordleSession, type UnwordleRowState } from "./stateMachine.ts";
import type { TileColor } from "./validation.ts";

export interface SessionRow {
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

export interface RowRow {
  id: number;
  session_id: number;
  row_index: number;
  solved: boolean;
  solved_word: string | null;
  solved_at: string | null;
  attempts: number;
  invalid_submissions: number;
}

export interface BankPuzzleRow {
  id: number;
  event_id: number;
  puzzle_number: number;
  solution_word: string;
  row_patterns: TileColor[][];
  status: "DRAFT" | "PUBLISHED";
}

/** An all-Green row has no ambiguity to guess — it's auto-solved as a
 * freebie reveal (see stateMachine.ts's createSession for the original
 * single-puzzle version of this same rule). */
export function computeFreebieRows(rowPatterns: TileColor[][]): { freebieRows: boolean[]; freebieCount: number } {
  const freebieRows = rowPatterns.map((pattern) => pattern.every((c) => c === "GREEN"));
  const freebieCount = freebieRows.filter(Boolean).length;
  return { freebieRows, freebieCount };
}

export function hydrateSession(sessionRow: SessionRow, rowRows: RowRow[], solution: string, rowPatterns: TileColor[][]): UnwordleSession {
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

export async function loadSessionAndPuzzle(db: ReturnType<typeof supabaseAdmin>, sessionId: number) {
  const { data: sessionRow } = await db.from("wl_unwordle_sessions").select("*").eq("id", sessionId).maybeSingle<SessionRow>();
  if (!sessionRow) return null;
  const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("*").eq("id", sessionRow.puzzle_id).maybeSingle<BankPuzzleRow>();
  if (!puzzle) return null;
  const { data: rowRows } = await db.from("wl_unwordle_rows").select("*").eq("session_id", sessionId).order("row_index");
  const state = hydrateSession(sessionRow, (rowRows ?? []) as RowRow[], puzzle.solution_word, puzzle.row_patterns);
  return { sessionRow, puzzle, state };
}

export async function persistSession(db: ReturnType<typeof supabaseAdmin>, sessionId: number, expectedRowVersion: number, state: UnwordleSession): Promise<boolean> {
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

export async function persistRow(db: ReturnType<typeof supabaseAdmin>, sessionId: number, row: UnwordleRowState): Promise<number> {
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

/** Creates and immediately starts a player's session for one bank puzzle —
 * used both by round/start (bulk, puzzle #1 for every advanced player) and
 * by the single-player auto-advance/resume paths. Every session is born
 * IN_PROGRESS in the continuous-round model; there is no admin-triggered
 * per-puzzle start anymore. */
export async function createAndStartSession(
  db: ReturnType<typeof supabaseAdmin>,
  puzzle: BankPuzzleRow,
  eventPlayerId: number,
  now: number
): Promise<number> {
  const { freebieRows, freebieCount } = computeFreebieRows(puzzle.row_patterns);
  const { data: session, error } = await db
    .from("wl_unwordle_sessions")
    .insert({
      puzzle_id: puzzle.id,
      event_player_id: eventPlayerId,
      status: "IN_PROGRESS",
      start_time: new Date(now).toISOString(),
      rows_solved_count: freebieCount,
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: rowsError } = await db.from("wl_unwordle_rows").insert(
    Array.from({ length: puzzle.row_patterns.length }, (_, rowIndex) => ({
      session_id: session.id,
      row_index: rowIndex,
      solved: freebieRows[rowIndex],
      solved_word: freebieRows[rowIndex] ? puzzle.solution_word : null,
    }))
  );
  if (rowsError) throw rowsError;

  return session.id;
}

/** Lazily reconciles one player's round against the event's authoritative
 * `unwordle_round_ends_at` deadline — the same "check now() against a
 * stored deadline on every touch" pattern _shared/timedWordle/repo.ts's
 * loadAndReconcile already established for Timed Wordle, just scoped to a
 * whole round instead of per-try budgets. Force-ends whatever puzzle this
 * player is mid-solving, exactly like an admin End Round Now would. */
export async function reconcileRoundForPlayer(
  db: ReturnType<typeof supabaseAdmin>,
  event: { id: number; status: string; unwordle_round_ends_at: string | null },
  eventPlayerId: number,
  now: number
): Promise<{ forcedEnd: boolean }> {
  if (!event.unwordle_round_ends_at) return { forcedEnd: false };
  const deadline = new Date(event.unwordle_round_ends_at).getTime();
  if (now < deadline) return { forcedEnd: false };

  if (event.status !== "PLAYOFFS_CLOSED") {
    await db.from("wl_events").update({ status: "PLAYOFFS_CLOSED" }).eq("id", event.id);
  }

  const { data: puzzles } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", event.id);
  const puzzleIds = (puzzles ?? []).map((p) => p.id);
  if (puzzleIds.length === 0) return { forcedEnd: false };

  const { data: sessionRow } = await db
    .from("wl_unwordle_sessions")
    .select("*")
    .in("puzzle_id", puzzleIds)
    .eq("event_player_id", eventPlayerId)
    .eq("status", "IN_PROGRESS")
    .maybeSingle<SessionRow>();
  if (!sessionRow) return { forcedEnd: false };

  const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("*").eq("id", sessionRow.puzzle_id).maybeSingle<BankPuzzleRow>();
  if (!puzzle) return { forcedEnd: false };
  const { data: rowRows } = await db.from("wl_unwordle_rows").select("*").eq("session_id", sessionRow.id).order("row_index");
  const state = hydrateSession(sessionRow, (rowRows ?? []) as RowRow[], puzzle.solution_word, puzzle.row_patterns);

  // Stop time is the deadline itself, not whenever this reconcile happened
  // to run — a player shouldn't be credited or blamed for the lag between
  // the buzzer and someone/something next touching their session.
  const ended = adminEndSession(state, deadline);
  await persistSession(db, sessionRow.id, sessionRow.row_version, ended);
  return { forcedEnd: true };
}
