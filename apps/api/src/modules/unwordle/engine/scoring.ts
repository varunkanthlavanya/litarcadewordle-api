export interface RankableUnwordleSession {
  id: number;
  rowsSolvedCount: number;
  totalTimeMs: number;
  totalAttempts: number;
  totalInvalidSubmissions: number;
}

/** Sequential priority waterfall (PRD §4.2/§6.2.4): rows solved > time > attempts > invalid > id. */
export function compareUnwordleSessions(a: RankableUnwordleSession, b: RankableUnwordleSession): number {
  if (a.rowsSolvedCount !== b.rowsSolvedCount) return b.rowsSolvedCount - a.rowsSolvedCount;
  if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
  if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
  if (a.totalInvalidSubmissions !== b.totalInvalidSubmissions) return a.totalInvalidSubmissions - b.totalInvalidSubmissions;
  return a.id - b.id;
}

/** COMPLETED and ENDED sessions are ranked; EXITED is the sole exclusion (PRD §4.1). */
export function isRankable(status: string): boolean {
  return status === "COMPLETED" || status === "ENDED";
}
