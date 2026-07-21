import type { TileColor } from "./tiles.js";

export type UnwordleSessionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ENDED" | "EXITED";

export interface UnwordleRowDto {
  rowIndex: number;
  pattern: TileColor[];
  solved: boolean;
  solvedWord: string | null;
  solvedAt: number | null;
  attempts: number;
  invalidSubmissions: number;
}

export interface UnwordleStateDto {
  status: UnwordleSessionStatus;
  startTime: number | null;
  rows: UnwordleRowDto[];
  rowsSolvedCount: number;
  totalTimeMs: number;
  totalAttempts: number;
  totalInvalidSubmissions: number;
  /** The actual solution word — always sent regardless of row patterns, so
   * the player always has a fixed green reference row to work backward
   * from. Previously this only appeared when an admin happened to set one
   * of the 4 rows to an all-GREEN pattern (an easy-to-miss manual step);
   * now it's unconditional. */
  solutionWord: string;
}

/** Outcome of a single row/submit call — promoted from an ad hoc inline
 * type (previously only typed at the call site in UnwordleGame.tsx) to a
 * real shared type now that both the engine and the client need to agree
 * on its exact shape for the round-advance logic below. */
export type UnwordleSubmitOutcome =
  | { kind: "REJECTED_INVALID_WORD" }
  | { kind: "REJECTED_TILE_MISMATCH"; failedTiles: { position: number; reason: string }[] }
  | { kind: "ACCEPTED"; rowSolved: true; puzzleCompleted: boolean };

/** What happens to the ROUND (not just the one row) as a result of a
 * submit — this is the auto-advance discriminator the continuous-round
 * model needs, since a single accepted guess can now also complete a
 * puzzle, exhaust the whole bank, or land after the round's own deadline
 * already passed. */
export type UnwordleRoundOutcome = "CONTINUE" | "ADVANCED" | "BANK_EXHAUSTED" | "ROUND_ENDED";

export interface UnwordleRowSubmitResponse {
  outcome: UnwordleSubmitOutcome;
  roundOutcome: UnwordleRoundOutcome;
  /** The session id for whatever puzzle the player should now be looking
   * at — unchanged for CONTINUE, the NEXT puzzle's id for ADVANCED, and
   * meaningless (ignore) for BANK_EXHAUSTED/ROUND_ENDED. */
  sessionId: number;
  /** Null for BANK_EXHAUSTED/ROUND_ENDED (nothing left to play/show here —
   * the client reads `ended` from a follow-up status call instead). */
  state: UnwordleStateDto | null;
  puzzleNumber: number;
  bankSize: number;
  roundEndsAt: number | null;
}

export interface UnwordleSessionEndedPayload {
  sessionId: number;
  reason: "completed" | "admin_ended";
  solutionWord: string;
  revealedAnswers: string[];
  summary: {
    rowsSolvedCount: number;
    totalTimeMs: number;
    totalAttempts: number;
    totalInvalidSubmissions: number;
  };
  rows: UnwordleRowDto[];
}

/** One puzzle in an event's playoffs bank — the DTO behind the admin's
 * bank listing / tile-preview-grid, distinct from UnwordleStateDto (a
 * player's live in-progress view of one puzzle). */
export interface UnwordleBankPuzzleDto {
  id: number;
  puzzleNumber: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
  status: "DRAFT" | "PUBLISHED";
}

export interface UnwordleBulkUploadRowError {
  puzzleNumber: number | null;
  rowIndex: number | null;
  message: string;
}

export interface UnwordleBulkUploadResult {
  accepted: UnwordleBankPuzzleDto[];
  errors: UnwordleBulkUploadRowError[];
  bankSize: number;
  bankedCount: number;
}

/** Per-player round-level monitor state for the admin's live table —
 * collapses "what's actually going on with this player right now" into one
 * value instead of independently inferring it from several fields. */
export type UnwordleMonitorState = "PLAYING" | "BANK_EXHAUSTED" | "NOT_STARTED" | "EXITED_PAUSED" | "ROUND_ENDED";

export interface UnwordleSessionMonitorEntry {
  eventPlayerId: number;
  displayName: string | null;
  mobileNumber: string;
  /** Null for a player who was advanced but never got a session created —
   * a reachable state now that session creation only happens at Start
   * Round, not automatically at cutoff-confirm time. */
  sessionId: number | null;
  puzzleNumber: number | null;
  bankSize: number;
  rowsSolvedInCurrentPuzzle: number;
  totalPoints: number;
  totalPuzzlesCompleted: number;
  totalAttempts: number;
  monitorState: UnwordleMonitorState;
  /** Epoch ms this player's own clock runs out — null until they've
   * actually entered the game (see UnwordlePlayerState's READY_TO_ENTER). */
  deadlineAt: number | null;
}

/** Row-wise-points round leaderboard — replaces the old single-session,
 * time-ranked shape entirely (PRD Revision 3 §8: time is excluded from
 * ranking since the round starts/ends for everyone at the same instant). */
export interface UnwordleLeaderboardEntry {
  eventPlayerId: number;
  displayName: string | null;
  /** The player's first (puzzle #1) session id this round, used only as
   * the final deterministic tie-break — null for a player who was
   * advanced but never actually started (sorts after every real id). */
  roundStartSessionId: number | null;
  totalPoints: number;
  totalPuzzlesCompleted: number;
  totalAttempts: number;
  totalInvalidSubmissions: number;
  rank: number;
}

/** Collapses several previously-independent booleans (isFinalist,
 * sessionStatus, allFinalistsDone) into one discriminator the player UI
 * switches on directly. */
export type UnwordlePlayerState =
  | "NOT_A_FINALIST"
  | "AWAITING_ROUND_START"
  /** The admin has opened the round, but this player hasn't personally
   * clicked in yet — their clock has not started. Distinct from
   * AWAITING_ROUND_START (admin hasn't opened it at all yet). */
  | "READY_TO_ENTER"
  | "PLAYING"
  | "EXITED_AWAITING_RESUME"
  | "BANK_EXHAUSTED_WAITING"
  | "ROUND_ENDED";

export interface UnwordleRoundStatusDto {
  eventName: string;
  isFinalist: boolean;
  /** Always populated from the authenticated player's own token, regardless
   * of finalist status — lets the results screen match itself against a
   * leaderboard entry (which is keyed by eventPlayerId, not sessionId, now
   * that a player has many sessions across the round). */
  eventPlayerId: number;
  playerState: UnwordlePlayerState;
  sessionId: number | null;
  sessionStatus: UnwordleSessionStatus | null;
  state: UnwordleStateDto | null;
  ended: UnwordleSessionEndedPayload | null;
  puzzleNumber: number | null;
  bankSize: number | null;
  totalPoints: number;
  totalPuzzlesCompleted: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  bankExhausted: boolean;
  /** Replaces the old `allFinalistsDone` — true once the round itself has
   * ended (deadline passed or admin End Round Now), the point at which
   * rank becomes safe to reveal (it can no longer shift under anyone). */
  roundEnded: boolean;
}
