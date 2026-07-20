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

export interface UnwordleLeaderboardEntry {
  sessionId: number;
  eventPlayerId: number;
  displayName: string | null;
  rowsSolvedCount: number;
  totalTimeMs: number;
  totalAttempts: number;
  totalInvalidSubmissions: number;
  rank: number;
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

export interface UnwordleSessionMonitorEntry {
  eventPlayerId: number;
  displayName: string | null;
  mobileNumber: string;
  sessionId: number;
  status: UnwordleSessionStatus;
  rowsSolvedCount: number;
  elapsedMs: number;
  totalAttempts: number;
}

export interface UnwordleRoundStatusDto {
  eventName: string;
  isFinalist: boolean;
  sessionId: number | null;
  sessionStatus: UnwordleSessionStatus | null;
  state: UnwordleStateDto | null;
  ended: UnwordleSessionEndedPayload | null;
  /** True once every finalist's UNWORDLE session has reached a terminal
   * state (completed/ended/exited) — leaderboard rank must stay hidden
   * until then so a player's position can't visibly shift on them as other
   * finalists keep finishing throughout the day. */
  allFinalistsDone: boolean;
}
