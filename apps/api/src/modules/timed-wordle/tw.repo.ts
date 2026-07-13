import { pool } from "../../db/pool.js";
import type { TimedWordleSession, TimedWordleTry } from "./engine/stateMachine.js";
import type { TileColor } from "./engine/scoring.js";

export interface TimedWordlePuzzleRow {
  id: number;
  event_id: number;
  secret_word: string;
  definition: string | null;
  status: "SCHEDULED" | "OPEN" | "CLOSED";
  created_at: string;
}

export async function createPuzzle(params: {
  eventId: number;
  secretWord: string;
  definition?: string;
}): Promise<TimedWordlePuzzleRow> {
  const result = await pool.query<TimedWordlePuzzleRow>(
    `INSERT INTO timed_wordle_puzzles (event_id, secret_word, definition)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [params.eventId, params.secretWord.toUpperCase(), params.definition ?? null]
  );
  return result.rows[0];
}

export async function findPuzzleByEventId(eventId: number): Promise<TimedWordlePuzzleRow | null> {
  const result = await pool.query<TimedWordlePuzzleRow>(
    `SELECT * FROM timed_wordle_puzzles WHERE event_id = $1`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

export async function setPuzzleStatus(
  puzzleId: number,
  status: "SCHEDULED" | "OPEN" | "CLOSED"
): Promise<void> {
  await pool.query(`UPDATE timed_wordle_puzzles SET status = $2 WHERE id = $1`, [puzzleId, status]);
}

export interface TimedWordleSessionRow {
  id: number;
  puzzle_id: number;
  event_player_id: number;
  status: TimedWordleSession["status"] | "NOT_STARTED";
  session_started_at: Date | null;
  global_deadline_at: Date | null;
  current_try_number: number;
  current_try_started_at: Date | null;
  current_try_budget_ms: number | null;
  current_try_deadline_at: Date | null;
  grace_active: boolean;
  grace_deadline_at: Date | null;
  banked_surplus_ms: number;
  found: boolean;
  cumulative_time_ms: number | null;
  tries_used: number | null;
  tile_score: number | null;
  game_ended_at: Date | null;
  advanced_to_playoffs: boolean;
  advanced_at: Date | null;
  had_admin_clock_adjustment: boolean;
  total_adjustment_ms: number;
  last_activity_at: Date | null;
}

export interface TimedWordleTryRow {
  id: number;
  session_id: number;
  try_number: number;
  status: "SUBMITTED" | "SKIPPED";
  guess: string | null;
  feedback: TileColor[] | null;
  budget_ms: number;
  time_used_ms: number;
  used_grace: boolean;
  resolved_at: Date;
}

export async function findSessionByPuzzleAndPlayer(
  puzzleId: number,
  eventPlayerId: number
): Promise<TimedWordleSessionRow | null> {
  const result = await pool.query<TimedWordleSessionRow>(
    `SELECT * FROM timed_wordle_sessions WHERE puzzle_id = $1 AND event_player_id = $2`,
    [puzzleId, eventPlayerId]
  );
  return result.rows[0] ?? null;
}

export async function findOrCreateSession(puzzleId: number, eventPlayerId: number): Promise<TimedWordleSessionRow> {
  const existing = await pool.query<TimedWordleSessionRow>(
    `SELECT * FROM timed_wordle_sessions WHERE puzzle_id = $1 AND event_player_id = $2`,
    [puzzleId, eventPlayerId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pool.query<TimedWordleSessionRow>(
    `INSERT INTO timed_wordle_sessions (puzzle_id, event_player_id) VALUES ($1, $2) RETURNING *`,
    [puzzleId, eventPlayerId]
  );
  return inserted.rows[0];
}

export async function findSessionRowById(sessionId: number): Promise<TimedWordleSessionRow | null> {
  const result = await pool.query<TimedWordleSessionRow>(
    `SELECT * FROM timed_wordle_sessions WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0] ?? null;
}

export interface SessionMonitorRow {
  event_player_id: number;
  display_name: string | null;
  mobile_number: string;
  session_id: number | null;
  status: TimedWordleSession["status"] | "NOT_STARTED" | null;
  current_try_number: number | null;
  session_started_at: Date | null;
  global_deadline_at: Date | null;
  cumulative_time_ms: number | null;
  tries_used: number | null;
  last_activity_at: Date | null;
}

/** Every cohort member for this event, LEFT JOINed to their session (if any) — players
 * who haven't started yet still appear as "Idle" rows for the admin dashboard. */
export async function listSessionMonitorRows(puzzleId: number, eventId: number): Promise<SessionMonitorRow[]> {
  const result = await pool.query<SessionMonitorRow>(
    `SELECT
       ep.id AS event_player_id,
       ep.display_name,
       ep.mobile_number,
       s.id AS session_id,
       s.status,
       s.current_try_number,
       s.session_started_at,
       s.global_deadline_at,
       s.cumulative_time_ms,
       s.tries_used,
       s.last_activity_at
     FROM event_players ep
     LEFT JOIN timed_wordle_sessions s ON s.event_player_id = ep.id AND s.puzzle_id = $1
     WHERE ep.event_id = $2
     ORDER BY ep.id ASC`,
    [puzzleId, eventId]
  );
  return result.rows;
}

export async function markSessionsAdvancedToPlayoffs(sessionIds: number[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await pool.query(
    `UPDATE timed_wordle_sessions SET advanced_to_playoffs = true, advanced_at = now() WHERE id = ANY($1)`,
    [sessionIds]
  );
}

export async function listInProgressSessionRows(): Promise<Array<TimedWordleSessionRow & { event_id: number }>> {
  const result = await pool.query<TimedWordleSessionRow & { event_id: number }>(
    `SELECT s.*, p.event_id AS event_id
     FROM timed_wordle_sessions s
     JOIN timed_wordle_puzzles p ON p.id = s.puzzle_id
     WHERE s.status = 'IN_PROGRESS'`
  );
  return result.rows;
}

export async function listTriesForSession(sessionId: number): Promise<TimedWordleTryRow[]> {
  const result = await pool.query<TimedWordleTryRow>(
    `SELECT * FROM timed_wordle_tries WHERE session_id = $1 ORDER BY try_number ASC`,
    [sessionId]
  );
  return result.rows;
}

function toDateOrNull(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

export async function persistSessionState(sessionId: number, state: TimedWordleSession): Promise<void> {
  await pool.query(
    `UPDATE timed_wordle_sessions SET
       status = $2,
       session_started_at = $3,
       global_deadline_at = $4,
       current_try_number = $5,
       current_try_started_at = $6,
       current_try_budget_ms = $7,
       current_try_deadline_at = $8,
       grace_active = $9,
       grace_deadline_at = $10,
       banked_surplus_ms = $11,
       found = $12,
       cumulative_time_ms = $13,
       tries_used = $14,
       tile_score = $15,
       game_ended_at = $16,
       last_activity_at = now()
     WHERE id = $1`,
    [
      sessionId,
      state.status,
      new Date(state.sessionStartedAt),
      new Date(state.globalDeadlineAt),
      state.currentTryNumber,
      new Date(state.currentTryStartedAt),
      state.currentTryBudgetMs,
      new Date(state.currentTryDeadlineAt),
      state.graceActive,
      toDateOrNull(state.graceDeadlineAt),
      state.bankedSurplusMs,
      state.found,
      state.cumulativeTimeMs,
      state.triesUsed,
      state.tileScore,
      toDateOrNull(state.gameEndedAt),
    ]
  );
}

export async function persistTryRecord(sessionId: number, tryRecord: TimedWordleTry): Promise<void> {
  await pool.query(
    `INSERT INTO timed_wordle_tries (session_id, try_number, status, guess, feedback, budget_ms, time_used_ms, used_grace, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id, try_number) DO UPDATE SET
       status = EXCLUDED.status,
       guess = EXCLUDED.guess,
       feedback = EXCLUDED.feedback,
       budget_ms = EXCLUDED.budget_ms,
       time_used_ms = EXCLUDED.time_used_ms,
       used_grace = EXCLUDED.used_grace,
       resolved_at = EXCLUDED.resolved_at`,
    [
      sessionId,
      tryRecord.tryNumber,
      tryRecord.status,
      tryRecord.guess,
      tryRecord.feedback ? JSON.stringify(tryRecord.feedback) : null,
      tryRecord.budgetMs,
      tryRecord.timeUsedMs,
      tryRecord.usedGrace,
      new Date(tryRecord.resolvedAt),
    ]
  );
}

export async function recordTimerAdjustment(params: {
  sessionId: number;
  adminLabel: string;
  scope: "GLOBAL" | "CURRENT_TRY";
  deltaMs: number;
  reason?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO timer_adjustments (session_id, admin_label, scope, delta_ms, reason) VALUES ($1, $2, $3, $4, $5)`,
    [params.sessionId, params.adminLabel, params.scope, params.deltaMs, params.reason ?? null]
  );
  await pool.query(
    `UPDATE timed_wordle_sessions
     SET had_admin_clock_adjustment = true, total_adjustment_ms = total_adjustment_ms + $2
     WHERE id = $1`,
    [params.sessionId, params.deltaMs]
  );
}

/** Reconstructs the pure engine state from a DB row + its tries (used on player-start and boot recovery).
 * `secretWord` comes from the parent puzzle row, since sessions only store a puzzle_id FK. */
export function hydrateSession(
  row: TimedWordleSessionRow,
  tries: TimedWordleTryRow[],
  secretWord: string
): TimedWordleSession {
  return {
    secret: secretWord.toUpperCase(),
    status: row.status as TimedWordleSession["status"],
    sessionStartedAt: row.session_started_at?.getTime() ?? 0,
    globalDeadlineAt: row.global_deadline_at?.getTime() ?? 0,
    currentTryNumber: row.current_try_number,
    currentTryStartedAt: row.current_try_started_at?.getTime() ?? 0,
    currentTryBudgetMs: row.current_try_budget_ms ?? 0,
    currentTryDeadlineAt: row.current_try_deadline_at?.getTime() ?? 0,
    graceActive: row.grace_active,
    graceDeadlineAt: row.grace_deadline_at?.getTime() ?? null,
    bankedSurplusMs: row.banked_surplus_ms,
    tries: tries.map((t) => ({
      tryNumber: t.try_number,
      status: t.status,
      guess: t.guess,
      feedback: t.feedback,
      budgetMs: t.budget_ms,
      timeUsedMs: t.time_used_ms,
      usedGrace: t.used_grace,
      resolvedAt: t.resolved_at.getTime(),
    })),
    gameEndedAt: row.game_ended_at?.getTime() ?? null,
    found: row.found,
    cumulativeTimeMs: row.cumulative_time_ms ?? 0,
    triesUsed: row.tries_used ?? 0,
    tileScore: row.tile_score ?? 0,
  };
}
