import { writeAuditEntry } from "../audit/audit.service.js";
import { findEventById, updateEventStatus } from "../events/events.repo.js";
import { startSession, type TimedWordleSession } from "./engine/stateMachine.js";
import { compareTimedWordleSessions } from "./engine/scoring.js";
import { mapStatusToEndReason, TimedWordleScheduler } from "./engine/timerScheduler.js";
import type { TimedWordleRoundStatusDto, TimedWordleSessionMonitorEntry } from "@litarcadewordle/shared-types";
import {
  createPuzzle,
  findOrCreateSession,
  findPuzzleByEventId,
  findSessionByPuzzleAndPlayer,
  findSessionRowById,
  hydrateSession,
  listInProgressSessionRows,
  listSessionMonitorRows,
  listTriesForSession,
  persistSessionState,
  persistTryRecord,
  recordTimerAdjustment,
  setPuzzleStatus,
  type TimedWordlePuzzleRow,
} from "./tw.repo.js";
import { pool } from "../../db/pool.js";
import { isValidGuessWord } from "../dictionary/dictionary.service.js";
import { isPlayerOnline } from "../../websocket/presence.js";

export class TimedWordleServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimedWordleServiceError";
  }
}

export interface TimedWordleIo {
  emitToPlayerSession: (sessionId: number, event: string, payload: unknown) => void;
  emitToAdminEvent: (eventId: number, event: string, payload: unknown) => void;
}

/** One process-wide scheduler instance, wired to Postgres persistence and Socket.IO emission. */
export function createTimedWordleScheduler(io: TimedWordleIo): TimedWordleScheduler {
  return new TimedWordleScheduler({
    persistSession: persistSessionState,
    persistTry: persistTryRecord,
    emitToPlayerSession: io.emitToPlayerSession,
    emitToAdminEvent: io.emitToAdminEvent,
  });
}

export async function adminCreatePuzzle(params: {
  eventId: number;
  secretWord: string;
  definition?: string;
  adminLabel: string;
}): Promise<TimedWordlePuzzleRow> {
  if (params.secretWord.trim().length !== 5) {
    throw new TimedWordleServiceError("Secret word must be exactly 5 letters");
  }
  if (!isValidGuessWord(params.secretWord)) {
    throw new TimedWordleServiceError("Secret word must be a real dictionary word");
  }
  const puzzle = await createPuzzle(params);
  await writeAuditEntry({
    adminLabel: params.adminLabel,
    eventId: params.eventId,
    actionType: "TIMED_WORDLE_PUZZLE_CREATED",
    targetType: "timed_wordle_puzzle",
    targetIds: [puzzle.id],
  });
  return puzzle;
}

export async function adminSetPuzzleStatus(
  puzzleId: number,
  eventId: number,
  status: "SCHEDULED" | "OPEN" | "CLOSED",
  adminLabel: string
): Promise<void> {
  await setPuzzleStatus(puzzleId, status);
  if (status === "OPEN") {
    await updateEventStatus(eventId, "PRELIMS_LIVE");
  } else if (status === "CLOSED") {
    await updateEventStatus(eventId, "PRELIMS_CLOSED");
  }
  await writeAuditEntry({
    adminLabel,
    eventId,
    actionType: `TIMED_WORDLE_PUZZLE_${status}`,
    targetType: "timed_wordle_puzzle",
    targetIds: [puzzleId],
  });
}

const ROUND_CLOSE_BUFFER_MS = 6 * 60 * 1000; // a fresh session needs the full 6-minute clock to be fair

/** Player-triggered start (per-player independent clock — see plan §"Timed Wordle clock semantics"):
 * the admin only opens an eligibility window; each player's own clock starts here, on demand. */
export async function playerStartOrResumeSession(params: {
  eventId: number;
  eventPlayerId: number;
  scheduler: TimedWordleScheduler;
  now: number;
}): Promise<{ state: TimedWordleSession; sessionId: number }> {
  const puzzle = await findPuzzleByEventId(params.eventId);
  if (!puzzle || puzzle.status !== "OPEN") {
    throw new TimedWordleServiceError("Prelims round is not currently open");
  }

  const event = await findEventById(params.eventId);
  if (event?.round_closes_at) {
    const closesAt = new Date(event.round_closes_at).getTime();
    if (params.now + ROUND_CLOSE_BUFFER_MS > closesAt) {
      throw new TimedWordleServiceError("Round closes too soon to start a new game — not enough time left");
    }
  }

  const row = await findOrCreateSession(puzzle.id, params.eventPlayerId);

  if (row.status === "NOT_STARTED") {
    const state = startSession(puzzle.secret_word, params.now);
    await persistSessionState(row.id, state);
    params.scheduler.register(row.id, params.eventId, state, puzzle.definition);
    return { state, sessionId: row.id };
  }

  const tries = await listTriesForSession(row.id);
  const state = hydrateSession(row, tries, puzzle.secret_word);

  if (row.status === "IN_PROGRESS" && !params.scheduler.isActive(row.id)) {
    params.scheduler.register(row.id, params.eventId, state, puzzle.definition);
  }

  return { state, sessionId: row.id };
}

const TERMINAL_STATUSES = new Set(["FOUND", "NOT_FOUND_TRIES", "NOT_FOUND_TIME", "ADMIN_ENDED"]);

/** Read-only status check for the Waiting Lobby (P2) — never creates a session row,
 * so simply visiting the lobby doesn't start a player's clock. */
export async function getPlayerRoundStatus(params: {
  eventId: number;
  eventPlayerId: number;
}): Promise<TimedWordleRoundStatusDto> {
  const event = await findEventById(params.eventId);
  if (!event) {
    throw new TimedWordleServiceError("Event not found");
  }

  const puzzle = await findPuzzleByEventId(params.eventId);
  const sessionRow = puzzle ? await findSessionByPuzzleAndPlayer(puzzle.id, params.eventPlayerId) : null;

  let result: TimedWordleRoundStatusDto["result"] = null;
  if (puzzle && sessionRow && TERMINAL_STATUSES.has(sessionRow.status)) {
    result = {
      reason: mapStatusToEndReason(sessionRow.status as TimedWordleSession["status"]),
      found: sessionRow.found,
      cumulativeTimeMs: sessionRow.cumulative_time_ms ?? 0,
      triesUsed: sessionRow.tries_used ?? 0,
      tileScore: sessionRow.tile_score ?? 0,
      secretWord: puzzle.secret_word,
      definition: puzzle.definition,
    };
  }

  return {
    eventName: event.name,
    roundStatus: puzzle?.status ?? "SCHEDULED",
    roundOpensAt: event.round_opens_at,
    roundClosesAt: event.round_closes_at,
    sessionStatus: sessionRow?.status ?? null,
    sessionId: sessionRow?.id ?? null,
    result,
  };
}

export async function recoverInProgressSessions(scheduler: TimedWordleScheduler): Promise<number> {
  const rows = await listInProgressSessionRows();
  let count = 0;
  for (const row of rows) {
    const puzzleResult = await pool.query<{ secret_word: string; definition: string | null }>(
      `SELECT secret_word, definition FROM timed_wordle_puzzles WHERE id = $1`,
      [row.puzzle_id]
    );
    const secretWord = puzzleResult.rows[0]?.secret_word;
    if (!secretWord) continue;

    const tries = await listTriesForSession(row.id);
    const state = hydrateSession(row, tries, secretWord);
    scheduler.register(row.id, row.event_id, state, puzzleResult.rows[0]?.definition ?? null);
    count += 1;
  }
  return count;
}

export async function submitGuess(
  scheduler: TimedWordleScheduler,
  sessionId: number,
  guess: string,
  now: number
) {
  if (guess.length !== 5 || !/^[A-Za-z]+$/.test(guess)) {
    throw new TimedWordleServiceError("Guess must be exactly 5 letters");
  }
  return scheduler.submitGuess(sessionId, guess, now);
}

export async function adminEndOneSession(
  scheduler: TimedWordleScheduler,
  sessionId: number,
  adminLabel: string,
  reason?: string
): Promise<void> {
  const state = await scheduler.adminEnd(sessionId, Date.now());
  await writeAuditEntry({
    adminLabel,
    actionType: "TIMED_WORDLE_SESSION_ENDED",
    targetType: "timed_wordle_session",
    targetIds: [sessionId],
    reason,
    metadata: { finalStatus: state.status },
  });
}

export async function adminBulkEndSessions(
  scheduler: TimedWordleScheduler,
  sessionIds: number[],
  adminLabel: string,
  reason?: string
): Promise<{ succeeded: number[]; failed: number[] }> {
  const succeeded: number[] = [];
  const failed: number[] = [];
  for (const sessionId of sessionIds) {
    try {
      await scheduler.adminEnd(sessionId, Date.now());
      succeeded.push(sessionId);
    } catch {
      failed.push(sessionId);
    }
  }
  await writeAuditEntry({
    adminLabel,
    actionType: "TIMED_WORDLE_BULK_SESSION_END",
    targetType: "timed_wordle_session",
    targetIds: sessionIds,
    reason,
    metadata: { succeeded: succeeded.length, failed: failed.length },
  });
  return { succeeded, failed };
}

export async function adminAdjustClock(params: {
  scheduler: TimedWordleScheduler;
  sessionId: number;
  deltaSeconds: number;
  scope: "GLOBAL" | "CURRENT_TRY";
  adminLabel: string;
  reason?: string;
}): Promise<TimedWordleSession> {
  const deltaMs = params.deltaSeconds * 1000;
  const state =
    params.scope === "GLOBAL"
      ? await params.scheduler.adjustGlobal(params.sessionId, deltaMs)
      : await params.scheduler.adjustCurrentTry(params.sessionId, deltaMs);

  await recordTimerAdjustment({
    sessionId: params.sessionId,
    adminLabel: params.adminLabel,
    scope: params.scope,
    deltaMs,
    reason: params.reason,
  });

  return state;
}

const TERMINAL_TW_STATUSES = new Set(["FOUND", "NOT_FOUND_TRIES", "NOT_FOUND_TIME", "ADMIN_ENDED"]);

export async function getSessionMonitor(eventId: number): Promise<TimedWordleSessionMonitorEntry[]> {
  const puzzle = await findPuzzleByEventId(eventId);
  if (!puzzle) return [];

  const rows = await listSessionMonitorRows(puzzle.id, eventId);

  return rows.map((r) => {
    const online = isPlayerOnline(r.event_player_id);
    let playerState: TimedWordleSessionMonitorEntry["playerState"] = "IDLE";
    let elapsedMs: number | null = null;

    if (r.status === "IN_PROGRESS") {
      playerState = "IN_GAME";
      elapsedMs = r.session_started_at ? Date.now() - r.session_started_at.getTime() : null;
    } else if (r.status && TERMINAL_TW_STATUSES.has(r.status)) {
      playerState = "POST_GAME";
      elapsedMs = r.cumulative_time_ms;
    }

    return {
      eventPlayerId: r.event_player_id,
      displayName: r.display_name,
      mobileNumber: r.mobile_number,
      online,
      playerState,
      sessionId: r.session_id,
      currentTryNumber: r.status === "IN_PROGRESS" ? r.current_try_number : null,
      elapsedMs,
      lastActivityAt: r.last_activity_at?.toISOString() ?? null,
    };
  });
}

export interface LeaderboardEntry {
  sessionId: number;
  eventPlayerId: number;
  found: boolean;
  cumulativeTimeMs: number;
  triesUsed: number;
  tileScore: number;
  rank: number;
}

export async function getLeaderboard(puzzleId: number): Promise<LeaderboardEntry[]> {
  const result = await pool.query<{
    id: number;
    event_player_id: number;
    found: boolean;
    cumulative_time_ms: number;
    tries_used: number;
    tile_score: number;
  }>(
    `SELECT id, event_player_id, found, cumulative_time_ms, tries_used, tile_score
     FROM timed_wordle_sessions
     WHERE puzzle_id = $1
       AND status IN ('FOUND', 'NOT_FOUND_TRIES', 'NOT_FOUND_TIME', 'ADMIN_ENDED')`,
    [puzzleId]
  );

  const rankable = result.rows.map((r) => ({
    id: r.id,
    found: r.found,
    cumulativeTimeMs: r.cumulative_time_ms,
    triesUsed: r.tries_used,
    tileScore: r.tile_score,
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

export async function findSessionSummary(sessionId: number) {
  return findSessionRowById(sessionId);
}
