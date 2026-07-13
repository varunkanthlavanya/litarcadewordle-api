import { pool } from "../../db/pool.js";
import type { TileColor } from "@litarcadewordle/shared-types";
import type { UnwordleRowState, UnwordleSession } from "./engine/stateMachine.js";
import type { FailedTile } from "./engine/validation.js";

export interface UnwordlePuzzleRow {
  id: number;
  event_id: number;
  solution_word: string;
  row_patterns: TileColor[][];
  status: "DRAFT" | "PUBLISHED";
  created_at: string;
}

export async function createPuzzle(params: {
  eventId: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
}): Promise<UnwordlePuzzleRow> {
  const result = await pool.query<UnwordlePuzzleRow>(
    `INSERT INTO unwordle_puzzles (event_id, solution_word, row_patterns)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [params.eventId, params.solutionWord.toUpperCase(), JSON.stringify(params.rowPatterns)]
  );
  return result.rows[0];
}

export async function findPuzzleByEventId(eventId: number): Promise<UnwordlePuzzleRow | null> {
  const result = await pool.query<UnwordlePuzzleRow>(`SELECT * FROM unwordle_puzzles WHERE event_id = $1`, [eventId]);
  return result.rows[0] ?? null;
}

export async function setPuzzleStatus(puzzleId: number, status: "DRAFT" | "PUBLISHED"): Promise<void> {
  await pool.query(`UPDATE unwordle_puzzles SET status = $2 WHERE id = $1`, [puzzleId, status]);
}

export interface UnwordleSessionRow {
  id: number;
  puzzle_id: number;
  event_player_id: number;
  status: UnwordleSession["status"];
  start_time: Date | null;
  stop_time: Date | null;
  rows_solved_count: number;
  total_time_ms: number;
  total_attempts: number;
  total_invalid_submissions: number;
  excluded_from_leaderboard: boolean;
  last_activity_at: Date | null;
}

export interface UnwordleRowRow {
  id: number;
  session_id: number;
  row_index: number;
  solved: boolean;
  solved_word: string | null;
  solved_at: Date | null;
  attempts: number;
  invalid_submissions: number;
}

export async function findOrCreateSession(puzzleId: number, eventPlayerId: number): Promise<UnwordleSessionRow> {
  const existing = await pool.query<UnwordleSessionRow>(
    `SELECT * FROM unwordle_sessions WHERE puzzle_id = $1 AND event_player_id = $2`,
    [puzzleId, eventPlayerId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<UnwordleSessionRow>(
      `INSERT INTO unwordle_sessions (puzzle_id, event_player_id) VALUES ($1, $2) RETURNING *`,
      [puzzleId, eventPlayerId]
    );
    const session = inserted.rows[0];
    for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
      await client.query(`INSERT INTO unwordle_rows (session_id, row_index) VALUES ($1, $2)`, [session.id, rowIndex]);
    }
    await client.query("COMMIT");
    return session;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function findSessionRowById(sessionId: number): Promise<UnwordleSessionRow | null> {
  const result = await pool.query<UnwordleSessionRow>(`SELECT * FROM unwordle_sessions WHERE id = $1`, [sessionId]);
  return result.rows[0] ?? null;
}

export async function findSessionByPuzzleAndPlayer(
  puzzleId: number,
  eventPlayerId: number
): Promise<UnwordleSessionRow | null> {
  const result = await pool.query<UnwordleSessionRow>(
    `SELECT * FROM unwordle_sessions WHERE puzzle_id = $1 AND event_player_id = $2`,
    [puzzleId, eventPlayerId]
  );
  return result.rows[0] ?? null;
}

export async function listSessionsForPuzzle(puzzleId: number): Promise<UnwordleSessionRow[]> {
  const result = await pool.query<UnwordleSessionRow>(`SELECT * FROM unwordle_sessions WHERE puzzle_id = $1`, [
    puzzleId,
  ]);
  return result.rows;
}

export interface UnwordleSessionMonitorRow extends UnwordleSessionRow {
  display_name: string | null;
  mobile_number: string;
}

/** Only finalists (players with a session for this puzzle) appear here — unlike
 * Timed Wordle's monitor, most of the cohort never gets a Playoffs session at all. */
export async function listSessionMonitorRows(puzzleId: number): Promise<UnwordleSessionMonitorRow[]> {
  const result = await pool.query<UnwordleSessionMonitorRow>(
    `SELECT s.*, ep.display_name, ep.mobile_number
     FROM unwordle_sessions s
     JOIN event_players ep ON ep.id = s.event_player_id
     WHERE s.puzzle_id = $1
     ORDER BY ep.id ASC`,
    [puzzleId]
  );
  return result.rows;
}

export async function listInProgressSessionRows(): Promise<Array<UnwordleSessionRow & { event_id: number }>> {
  const result = await pool.query<UnwordleSessionRow & { event_id: number }>(
    `SELECT s.*, p.event_id AS event_id
     FROM unwordle_sessions s
     JOIN unwordle_puzzles p ON p.id = s.puzzle_id
     WHERE s.status = 'IN_PROGRESS'`
  );
  return result.rows;
}

export async function listRowsForSession(sessionId: number): Promise<UnwordleRowRow[]> {
  const result = await pool.query<UnwordleRowRow>(
    `SELECT * FROM unwordle_rows WHERE session_id = $1 ORDER BY row_index ASC`,
    [sessionId]
  );
  return result.rows;
}

export async function persistSessionState(sessionId: number, state: UnwordleSession): Promise<void> {
  await pool.query(
    `UPDATE unwordle_sessions SET
       status = $2,
       start_time = $3,
       stop_time = $4,
       rows_solved_count = $5,
       total_time_ms = $6,
       total_attempts = $7,
       total_invalid_submissions = $8,
       excluded_from_leaderboard = $9,
       last_activity_at = now()
     WHERE id = $1`,
    [
      sessionId,
      state.status,
      state.startTime !== null ? new Date(state.startTime) : null,
      state.stopTime !== null ? new Date(state.stopTime) : null,
      state.rowsSolvedCount,
      state.totalTimeMs,
      state.totalAttempts,
      state.totalInvalidSubmissions,
      state.excludedFromLeaderboard,
    ]
  );
}

export async function persistRowState(sessionId: number, row: UnwordleRowState): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `UPDATE unwordle_rows SET solved = $3, solved_word = $4, solved_at = $5, attempts = $6, invalid_submissions = $7
     WHERE session_id = $1 AND row_index = $2
     RETURNING id`,
    [
      sessionId,
      row.rowIndex,
      row.solved,
      row.solvedWord,
      row.solvedAt !== null ? new Date(row.solvedAt) : null,
      row.attempts,
      row.invalidSubmissions,
    ]
  );
  return result.rows[0].id;
}

export async function insertRowAttempt(params: {
  rowId: number;
  guessWord: string;
  isValidWord: boolean;
  satisfiesTiles: boolean;
  failedTileReasons: FailedTile[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO unwordle_row_attempts (row_id, guess_word, is_valid_word, satisfies_tiles, failed_tile_reasons)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.rowId,
      params.guessWord,
      params.isValidWord,
      params.satisfiesTiles,
      JSON.stringify(params.failedTileReasons),
    ]
  );
}

/** Reconstructs the pure engine state from DB rows (used on player-start and boot recovery). */
export function hydrateSession(
  sessionRow: UnwordleSessionRow,
  rowRows: UnwordleRowRow[],
  solution: string,
  rowPatterns: TileColor[][]
): UnwordleSession {
  return {
    solution: solution.toUpperCase(),
    status: sessionRow.status,
    startTime: sessionRow.start_time?.getTime() ?? null,
    stopTime: sessionRow.stop_time?.getTime() ?? null,
    rows: rowRows.map((r) => ({
      rowIndex: r.row_index,
      pattern: rowPatterns[r.row_index],
      solved: r.solved,
      solvedWord: r.solved_word,
      solvedAt: r.solved_at?.getTime() ?? null,
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
