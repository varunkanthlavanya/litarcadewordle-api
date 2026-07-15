import type { TileColor } from "./tiles.js";

export type TimedWordleSessionStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "FOUND"
  | "NOT_FOUND_TRIES"
  | "NOT_FOUND_TIME"
  | "ADMIN_ENDED";

export interface TimedWordleTryDto {
  tryNumber: number;
  status: "SUBMITTED" | "SKIPPED";
  guess: string | null;
  feedback: TileColor[] | null;
  budgetMs: number;
  timeUsedMs: number;
  usedGrace: boolean;
  resolvedAt: number;
}

export interface TimedWordleStateDto {
  status: TimedWordleSessionStatus;
  currentTryNumber: number;
  currentTryDeadlineAt: number;
  graceActive: boolean;
  graceDeadlineAt: number | null;
  globalDeadlineAt: number;
  bankedSurplusMs: number;
  tries: TimedWordleTryDto[];
  found: boolean;
  cumulativeTimeMs: number;
  triesUsed: number;
  tileScore: number;
}

export interface TimedWordleLeaderboardEntry {
  sessionId: number;
  eventPlayerId: number;
  found: boolean;
  cumulativeTimeMs: number;
  triesUsed: number;
  tileScore: number;
  rank: number;
}

export interface CutoffPreviewRow extends TimedWordleLeaderboardEntry {
  withinCutoff: boolean;
}

export interface TimedWordleRoundStatusDto {
  eventName: string;
  roundStatus: "SCHEDULED" | "OPEN" | "CLOSED";
  roundOpensAt: string | null;
  roundClosesAt: string | null;
  sessionStatus: TimedWordleSessionStatus | null;
  sessionId: number | null;
  /** True once this player has been advanced to the UNWORDLE playoffs round
   * — a terminal `result` alone doesn't distinguish "finished, not advancing"
   * from "finished, now belongs in the playoffs flow instead." */
  advancedToPlayoffs: boolean;
  result: (TimedWordleGameEndedPayload["summary"] & {
    reason: TimedWordleGameEndedPayload["reason"];
    secretWord: string;
    definition: string | null;
  }) | null;
}

export type TimedWordlePlayerState = "IDLE" | "IN_GAME" | "POST_GAME";

export interface TimedWordleSessionMonitorEntry {
  eventPlayerId: number;
  displayName: string | null;
  mobileNumber: string;
  online: boolean;
  playerState: TimedWordlePlayerState;
  sessionId: number | null;
  currentTryNumber: number | null;
  elapsedMs: number | null;
  lastActivityAt: string | null;
}

export interface TimedWordleGameEndedPayload {
  sessionId: number;
  reason: "solved" | "tries_exhausted" | "time_expired" | "admin_forced" | "unknown";
  secretWord: string;
  definition: string | null;
  summary: {
    found: boolean;
    cumulativeTimeMs: number;
    triesUsed: number;
    tileScore: number;
  };
}
