import type {
  TileColor,
  UnwordleLeaderboardEntry,
  UnwordleRoundStatusDto,
  UnwordleSessionEndedPayload,
  UnwordleSessionMonitorEntry,
} from "@litarcadewordle/shared-types";
import { writeAuditEntry } from "../audit/audit.service.js";
import { findEventById } from "../events/events.repo.js";
import { allValidGuessWords, isValidGuessWord } from "../dictionary/dictionary.service.js";
import {
  adminEndSession,
  adminStartSession,
  playerExitSession,
  submitWord,
  type UnwordleSession,
} from "./engine/stateMachine.js";
import { compareUnwordleSessions, isRankable } from "./engine/scoring.js";
import { checkRowSatisfiability, validatePuzzlePatterns } from "./engine/puzzleValidator.js";
import {
  createPuzzle,
  findOrCreateSession,
  findPuzzleByEventId,
  findSessionByPuzzleAndPlayer,
  findSessionRowById,
  hydrateSession,
  insertRowAttempt,
  listInProgressSessionRows,
  listRowsForSession,
  listSessionMonitorRows,
  listSessionsForPuzzle,
  persistRowState,
  persistSessionState,
  setPuzzleStatus,
  type UnwordlePuzzleRow,
} from "./uw.repo.js";

export class UnwordleServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnwordleServiceError";
  }
}

export interface UnwordleIo {
  emitToPlayerSession: (sessionId: number, event: string, payload: unknown) => void;
  emitToAdminEvent: (eventId: number, event: string, payload: unknown) => void;
}

const ROWS_PER_PUZZLE = 4;
const ROW_LENGTH = 5;

function isValidPattern(pattern: unknown): pattern is TileColor[] {
  return (
    Array.isArray(pattern) &&
    pattern.length === ROW_LENGTH &&
    pattern.every((c) => c === "GREEN" || c === "YELLOW" || c === "GRAY")
  );
}

export async function adminCreatePuzzle(params: {
  eventId: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
  adminLabel: string;
}): Promise<{ puzzle: UnwordlePuzzleRow; validation: ReturnType<typeof validatePuzzlePatterns> }> {
  if (params.solutionWord.trim().length !== 5) {
    throw new UnwordleServiceError("Solution word must be exactly 5 letters");
  }
  if (!isValidGuessWord(params.solutionWord)) {
    throw new UnwordleServiceError("Solution word must be a real dictionary word");
  }
  if (params.rowPatterns.length !== ROWS_PER_PUZZLE || !params.rowPatterns.every(isValidPattern)) {
    throw new UnwordleServiceError(`Exactly ${ROWS_PER_PUZZLE} row patterns of ${ROW_LENGTH} tiles each are required`);
  }

  const validation = validatePuzzlePatterns(params.solutionWord, params.rowPatterns, allValidGuessWords());
  if (!validation.valid) {
    const badRows = validation.rowResults.filter((r) => !r.satisfiable).map((r) => r.rowIndex + 1);
    throw new UnwordleServiceError(`Row(s) ${badRows.join(", ")} have no valid word satisfying that pattern`);
  }

  const puzzle = await createPuzzle(params);
  await writeAuditEntry({
    adminLabel: params.adminLabel,
    eventId: params.eventId,
    actionType: "UNWORDLE_PUZZLE_CREATED",
    targetType: "unwordle_puzzle",
    targetIds: [puzzle.id],
  });

  return { puzzle, validation };
}

export async function checkPuzzlePatterns(solutionWord: string, rowPatterns: TileColor[][]) {
  return validatePuzzlePatterns(solutionWord, rowPatterns, allValidGuessWords());
}

/** Admin explicitly starts a specific player's session — their stopwatch begins now (PRD §2.4/§2.5). */
export async function adminStart(params: { sessionId: number; eventId: number; io: UnwordleIo; adminLabel: string }) {
  const row = await findSessionRowById(params.sessionId);
  if (!row) throw new UnwordleServiceError("Session not found");

  const puzzleResult = await findPuzzleByEventId(params.eventId);
  if (!puzzleResult) throw new UnwordleServiceError("Puzzle not found");

  const rows = await listRowsForSession(params.sessionId);
  const state = hydrateSession(row, rows, puzzleResult.solution_word, puzzleResult.row_patterns);
  const started = adminStartSession(state, Date.now());

  await persistSessionState(params.sessionId, started);
  params.io.emitToPlayerSession(params.sessionId, "uw:session:started", { sessionId: params.sessionId, startAt: started.startTime });
  await writeAuditEntry({
    adminLabel: params.adminLabel,
    eventId: params.eventId,
    actionType: "UNWORDLE_SESSION_STARTED",
    targetType: "unwordle_session",
    targetIds: [params.sessionId],
  });

  return started;
}

export async function submitPlayerGuess(params: {
  sessionId: number;
  eventId: number;
  puzzleId: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
  rowIndex: number;
  guess: string;
  io: UnwordleIo;
}) {
  if (params.rowIndex < 0 || params.rowIndex >= ROWS_PER_PUZZLE) {
    throw new UnwordleServiceError("Invalid row index");
  }

  const sessionRow = await findSessionRowById(params.sessionId);
  if (!sessionRow) throw new UnwordleServiceError("Session not found");

  const rowRows = await listRowsForSession(params.sessionId);
  const state = hydrateSession(sessionRow, rowRows, params.solutionWord, params.rowPatterns);

  const { session, outcome } = submitWord(state, params.rowIndex, params.guess, Date.now(), isValidGuessWord);

  await persistSessionState(params.sessionId, session);
  const rowDbId = await persistRowState(params.sessionId, session.rows[params.rowIndex]);
  await insertRowAttempt({
    rowId: rowDbId,
    guessWord: params.guess.toUpperCase(),
    isValidWord: outcome.kind !== "REJECTED_INVALID_WORD",
    satisfiesTiles: outcome.kind === "ACCEPTED",
    failedTileReasons: outcome.kind === "REJECTED_TILE_MISMATCH" ? outcome.failedTiles : [],
  });

  if (session.status === "COMPLETED") {
    params.io.emitToPlayerSession(params.sessionId, "uw:session:ended", buildEndedPayload(params.sessionId, "completed", session));
    params.io.emitToAdminEvent(params.eventId, "admin:session:update", {
      sessionId: params.sessionId,
      patch: { status: session.status, lastActivityAt: new Date().toISOString() },
    });
  } else {
    params.io.emitToAdminEvent(params.eventId, "admin:session:update", {
      sessionId: params.sessionId,
      patch: {
        status: session.status,
        rowsSolved: session.rowsSolvedCount,
        lastActivityAt: new Date().toISOString(),
      },
    });
  }

  return { session, outcome };
}

/** Every row's answer is revealed on session end (PRD §2.5) — including rows the
 * player never solved, so a fresh satisfying word is looked up for those. */
function buildEndedPayload(
  sessionId: number,
  reason: "completed" | "admin_ended",
  session: UnwordleSession
): UnwordleSessionEndedPayload {
  return {
    sessionId,
    reason,
    revealedAnswers: session.rows.map((r) => {
      if (r.solvedWord) return r.solvedWord;
      return checkRowSatisfiability(session.solution, r.pattern, allValidGuessWords(), 1).sampleWords[0] ?? "";
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

export async function adminEndOne(params: {
  sessionId: number;
  eventId: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
  io: UnwordleIo;
  adminLabel: string;
  reason?: string;
}) {
  const sessionRow = await findSessionRowById(params.sessionId);
  if (!sessionRow) throw new UnwordleServiceError("Session not found");
  if (sessionRow.status !== "IN_PROGRESS") return;

  const rowRows = await listRowsForSession(params.sessionId);
  const state = hydrateSession(sessionRow, rowRows, params.solutionWord, params.rowPatterns);
  const ended = adminEndSession(state, Date.now());

  await persistSessionState(params.sessionId, ended);
  params.io.emitToPlayerSession(params.sessionId, "uw:session:ended", buildEndedPayload(params.sessionId, "admin_ended", ended));
  params.io.emitToAdminEvent(params.eventId, "admin:session:update", {
    sessionId: params.sessionId,
    patch: { status: ended.status, lastActivityAt: new Date().toISOString() },
  });

  await writeAuditEntry({
    adminLabel: params.adminLabel,
    eventId: params.eventId,
    actionType: "UNWORDLE_SESSION_ENDED",
    targetType: "unwordle_session",
    targetIds: [params.sessionId],
    reason: params.reason,
  });
}

export async function adminEndAllInProgress(params: {
  eventId: number;
  puzzleId: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
  io: UnwordleIo;
  adminLabel: string;
}): Promise<number> {
  const sessions = await listSessionsForPuzzle(params.puzzleId);
  const inProgress = sessions.filter((s) => s.status === "IN_PROGRESS");
  for (const s of inProgress) {
    await adminEndOne({
      sessionId: s.id,
      eventId: params.eventId,
      solutionWord: params.solutionWord,
      rowPatterns: params.rowPatterns,
      io: params.io,
      adminLabel: params.adminLabel,
      reason: "Bulk end — end game for everyone",
    });
  }
  return inProgress.length;
}

export async function playerExit(params: {
  sessionId: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
}): Promise<UnwordleSession> {
  const sessionRow = await findSessionRowById(params.sessionId);
  if (!sessionRow) throw new UnwordleServiceError("Session not found");

  const rowRows = await listRowsForSession(params.sessionId);
  const state = hydrateSession(sessionRow, rowRows, params.solutionWord, params.rowPatterns);
  const exited = playerExitSession(state, Date.now());
  await persistSessionState(params.sessionId, exited);
  return exited;
}

export async function ensurePlayerSession(puzzleId: number, eventPlayerId: number) {
  return findOrCreateSession(puzzleId, eventPlayerId);
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

/** Read-only status check for the Waiting/Locked screen (P6) and returning-player
 * results (P8) — a session only exists once the admin has advanced this player to
 * playoffs (see the cutoff tool), so `isFinalist: false` means "not advanced yet". */
export async function getPlayerRoundStatus(eventId: number, eventPlayerId: number): Promise<UnwordleRoundStatusDto> {
  const event = await findEventById(eventId);
  if (!event) throw new UnwordleServiceError("Event not found");

  const notAFinalist: UnwordleRoundStatusDto = {
    eventName: event.name,
    isFinalist: false,
    sessionId: null,
    sessionStatus: null,
    state: null,
    ended: null,
  };

  const puzzle = await findPuzzleByEventId(eventId);
  if (!puzzle) return notAFinalist;

  const sessionRow = await findSessionByPuzzleAndPlayer(puzzle.id, eventPlayerId);
  if (!sessionRow) return notAFinalist;

  const rowRows = await listRowsForSession(sessionRow.id);
  const state = hydrateSession(sessionRow, rowRows, puzzle.solution_word, puzzle.row_patterns);

  if (sessionRow.status === "COMPLETED" || sessionRow.status === "ENDED") {
    return {
      eventName: event.name,
      isFinalist: true,
      sessionId: sessionRow.id,
      sessionStatus: sessionRow.status,
      state: null,
      ended: buildEndedPayload(sessionRow.id, sessionRow.status === "COMPLETED" ? "completed" : "admin_ended", state),
    };
  }

  return {
    eventName: event.name,
    isFinalist: true,
    sessionId: sessionRow.id,
    sessionStatus: sessionRow.status,
    state: toStateDto(state),
    ended: null,
  };
}

export async function adminSetPuzzleStatus(
  puzzleId: number,
  eventId: number,
  status: "DRAFT" | "PUBLISHED",
  adminLabel: string
): Promise<void> {
  await setPuzzleStatus(puzzleId, status);
  await writeAuditEntry({ adminLabel, eventId, actionType: `UNWORDLE_PUZZLE_${status}`, targetType: "unwordle_puzzle", targetIds: [puzzleId] });
}

export async function getSessionMonitor(eventId: number): Promise<UnwordleSessionMonitorEntry[]> {
  const puzzle = await findPuzzleByEventId(eventId);
  if (!puzzle) return [];

  const rows = await listSessionMonitorRows(puzzle.id);
  const now = Date.now();

  return rows.map((r) => ({
    eventPlayerId: r.event_player_id,
    displayName: r.display_name,
    mobileNumber: r.mobile_number,
    sessionId: r.id,
    status: r.status,
    rowsSolvedCount: r.rows_solved_count,
    elapsedMs: r.status === "IN_PROGRESS" && r.start_time ? now - r.start_time.getTime() : r.total_time_ms,
    totalAttempts: r.total_attempts,
  }));
}

export async function getLeaderboard(puzzleId: number): Promise<UnwordleLeaderboardEntry[]> {
  const sessions = await listSessionsForPuzzle(puzzleId);
  const rankable = sessions
    .filter((s) => isRankable(s.status))
    .map((s) => ({
      id: s.id,
      eventPlayerId: s.event_player_id,
      rowsSolvedCount: s.rows_solved_count,
      totalTimeMs: s.total_time_ms,
      totalAttempts: s.total_attempts,
      totalInvalidSubmissions: s.total_invalid_submissions,
    }));

  rankable.sort(compareUnwordleSessions);

  return rankable.map((r, index) => ({
    sessionId: r.id,
    eventPlayerId: r.eventPlayerId,
    rowsSolvedCount: r.rowsSolvedCount,
    totalTimeMs: r.totalTimeMs,
    totalAttempts: r.totalAttempts,
    totalInvalidSubmissions: r.totalInvalidSubmissions,
    rank: index + 1,
  }));
}

export async function recoverInProgressSessions(): Promise<number> {
  const rows = await listInProgressSessionRows();
  return rows.length; // UNWORDLE has no in-process scheduler to re-register — state is fully DB-driven
}
