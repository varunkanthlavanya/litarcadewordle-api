import type { TileColor } from "@litarcadewordle/shared-types";
import { ROWS_PER_PUZZLE, validateGuess, type FailedTile } from "./validation.js";

export type UnwordleSessionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ENDED" | "EXITED";

export interface UnwordleRowState {
  rowIndex: number;
  pattern: TileColor[];
  solved: boolean;
  solvedWord: string | null;
  solvedAt: number | null;
  attempts: number;
  invalidSubmissions: number;
}

export interface UnwordleSession {
  solution: string;
  status: UnwordleSessionStatus;
  startTime: number | null;
  stopTime: number | null;
  rows: UnwordleRowState[];
  rowsSolvedCount: number;
  totalTimeMs: number;
  totalAttempts: number;
  totalInvalidSubmissions: number;
  excludedFromLeaderboard: boolean;
}

export class InvalidUnwordleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUnwordleTransitionError";
  }
}

export function createSession(solution: string, rowPatterns: TileColor[][]): UnwordleSession {
  if (rowPatterns.length !== ROWS_PER_PUZZLE) {
    throw new InvalidUnwordleTransitionError(`Expected ${ROWS_PER_PUZZLE} row patterns`);
  }

  return {
    solution: solution.toUpperCase(),
    status: "NOT_STARTED",
    startTime: null,
    stopTime: null,
    rows: rowPatterns.map((pattern, rowIndex) => ({
      rowIndex,
      pattern,
      solved: false,
      solvedWord: null,
      solvedAt: null,
      attempts: 0,
      invalidSubmissions: 0,
    })),
    rowsSolvedCount: 0,
    totalTimeMs: 0,
    totalAttempts: 0,
    totalInvalidSubmissions: 0,
    excludedFromLeaderboard: false,
  };
}

/** Admin action: activates the puzzle for this player and starts their stopwatch (PRD §2.4/§2.5). */
export function adminStartSession(session: UnwordleSession, now: number): UnwordleSession {
  if (session.status !== "NOT_STARTED") {
    throw new InvalidUnwordleTransitionError(`Cannot start a session in status ${session.status}`);
  }
  return { ...session, status: "IN_PROGRESS", startTime: now };
}

function withMetricsSnapshot(session: UnwordleSession): UnwordleSession {
  const rowsSolvedCount = session.rows.filter((r) => r.solved).length;
  const totalAttempts = session.rows.reduce((sum, r) => sum + r.attempts, 0);
  const totalInvalidSubmissions = session.rows.reduce((sum, r) => sum + r.invalidSubmissions, 0);
  const totalTimeMs = session.startTime !== null && session.stopTime !== null ? session.stopTime - session.startTime : 0;

  return { ...session, rowsSolvedCount, totalAttempts, totalInvalidSubmissions, totalTimeMs };
}

export type SubmitWordOutcome =
  | { kind: "REJECTED_INVALID_WORD" }
  | { kind: "REJECTED_TILE_MISMATCH"; failedTiles: FailedTile[] }
  | { kind: "ACCEPTED"; rowSolved: true; puzzleCompleted: boolean };

export interface SubmitWordResult {
  session: UnwordleSession;
  outcome: SubmitWordOutcome;
}

/** Player submits a guess for one row (PRD §6.2.1 player_submit_word). */
export function submitWord(
  session: UnwordleSession,
  rowIndex: number,
  guess: string,
  now: number,
  isDictionaryWord: (word: string) => boolean
): SubmitWordResult {
  if (session.status !== "IN_PROGRESS") {
    throw new InvalidUnwordleTransitionError(`Cannot submit a guess for a session in status ${session.status}`);
  }

  const row = session.rows[rowIndex];
  if (!row) {
    throw new InvalidUnwordleTransitionError(`Row ${rowIndex} does not exist`);
  }
  if (row.solved) {
    throw new InvalidUnwordleTransitionError(`Row ${rowIndex} is already solved`);
  }

  const validation = validateGuess(guess, session.solution, row.pattern, isDictionaryWord);

  if (!validation.lengthValid || !validation.isDictionaryWord) {
    const rows = session.rows.map((r, i) => (i === rowIndex ? { ...r, invalidSubmissions: r.invalidSubmissions + 1 } : r));
    return { session: { ...session, rows }, outcome: { kind: "REJECTED_INVALID_WORD" } };
  }

  if (!validation.satisfiesAllTiles) {
    const rows = session.rows.map((r, i) => (i === rowIndex ? { ...r, attempts: r.attempts + 1 } : r));
    return {
      session: { ...session, rows },
      outcome: { kind: "REJECTED_TILE_MISMATCH", failedTiles: validation.failedTiles },
    };
  }

  const rows = session.rows.map((r, i) =>
    i === rowIndex
      ? { ...r, attempts: r.attempts + 1, solved: true, solvedWord: guess.toUpperCase(), solvedAt: now }
      : r
  );

  const allSolved = rows.every((r) => r.solved);
  let next: UnwordleSession = { ...session, rows };

  if (allSolved) {
    next = withMetricsSnapshot({ ...next, status: "COMPLETED", stopTime: now });
  }

  return { session: next, outcome: { kind: "ACCEPTED", rowSolved: true, puzzleCompleted: allSolved } };
}

/** Admin force-ends the session, revealing all rows and snapshotting metrics as-of now (PRD §2.5). */
export function adminEndSession(session: UnwordleSession, now: number): UnwordleSession {
  if (session.status !== "IN_PROGRESS") {
    throw new InvalidUnwordleTransitionError(`Cannot end a session in status ${session.status}`);
  }
  return withMetricsSnapshot({ ...session, status: "ENDED", stopTime: now });
}

/** Player voluntarily exits — the sole case excluded from the leaderboard (PRD §2.5/§4.1). */
export function playerExitSession(session: UnwordleSession, now: number): UnwordleSession {
  if (session.status !== "IN_PROGRESS") {
    throw new InvalidUnwordleTransitionError(`Cannot exit a session in status ${session.status}`);
  }
  return withMetricsSnapshot({ ...session, status: "EXITED", stopTime: now, excludedFromLeaderboard: true });
}
