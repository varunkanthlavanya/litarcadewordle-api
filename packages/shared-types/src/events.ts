export type EventStatus =
  | "DRAFT"
  | "COHORT_UPLOADED"
  | "PRELIMS_SCHEDULED"
  | "PRELIMS_LIVE"
  | "PRELIMS_CLOSED"
  | "PLAYOFFS_SCHEDULED"
  | "PLAYOFFS_LIVE"
  | "PLAYOFFS_CLOSED"
  | "ARCHIVED";

export interface EventSummary {
  id: number;
  name: string;
  status: EventStatus;
  timezone: string;
  roundOpensAt: string | null;
  roundClosesAt: string | null;
  prelimsTopN: number | null;
  playoffsWinnerCount: number | null;
  createdAt: string;
}

export interface EventPlayerSummary {
  id: number;
  eventId: number;
  mobileNumber: string;
  displayName: string | null;
  createdAt: string;
}

/** Matches the raw row shape actually returned by /admin/events (snake_case,
 * mirrors the Postgres columns directly — see apps/api events.repo.ts EventRow). */
export interface EventApiRow {
  id: number;
  name: string;
  status: EventStatus;
  timezone: string;
  round_opens_at: string | null;
  round_closes_at: string | null;
  prelims_top_n: number | null;
  playoffs_winner_count: number | null;
  created_at: string;
}

export interface EventApiRowWithCohortSize extends EventApiRow {
  cohort_size: number;
}

export interface EventPlayerApiRow {
  id: number;
  event_id: number;
  mobile_number: string;
  display_name: string | null;
  created_at: string;
}

export interface EventStats {
  cohortSize: number;
  onlineNow: number;
  completedCount: number;
}

export interface EventRosterEntry {
  eventPlayerId: number;
  displayName: string | null;
  mobileNumber: string;
  prelimsStatus: "NOT_STARTED" | "IN_PROGRESS" | "FOUND" | "NOT_FOUND_TRIES" | "NOT_FOUND_TIME" | "ADMIN_ENDED";
  advancedToPlayoffs: boolean;
  playoffsStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ENDED" | "EXITED" | null;
}
