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
}

export interface UnwordleLeaderboardEntry {
  sessionId: number;
  eventPlayerId: number;
  rowsSolvedCount: number;
  totalTimeMs: number;
  totalAttempts: number;
  totalInvalidSubmissions: number;
  rank: number;
}

export interface UnwordleSessionEndedPayload {
  sessionId: number;
  reason: "completed" | "admin_ended";
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
}
