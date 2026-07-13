import { pool } from "../../db/pool.js";
import type { EventStatus } from "@litarcadewordle/shared-types";

export interface EventRow {
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

export async function insertEvent(params: { name: string; timezone: string }): Promise<EventRow> {
  const result = await pool.query<EventRow>(
    `INSERT INTO events (name, timezone) VALUES ($1, $2) RETURNING *`,
    [params.name, params.timezone]
  );
  return result.rows[0];
}

export async function findEventById(id: number): Promise<EventRow | null> {
  const result = await pool.query<EventRow>(`SELECT * FROM events WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listEvents(): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(`SELECT * FROM events ORDER BY created_at DESC`);
  return result.rows;
}

export interface EventWithCohortSize extends EventRow {
  cohort_size: number;
}

export async function listEventsWithCohortSize(): Promise<EventWithCohortSize[]> {
  const result = await pool.query<EventWithCohortSize>(
    `SELECT e.*, COUNT(p.id)::int AS cohort_size
     FROM events e
     LEFT JOIN event_players p ON p.event_id = e.id
     GROUP BY e.id
     ORDER BY e.created_at DESC`
  );
  return result.rows;
}

export async function updateEventStatus(id: number, status: EventStatus): Promise<EventRow | null> {
  const result = await pool.query<EventRow>(
    `UPDATE events SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return result.rows[0] ?? null;
}

export async function updateEventConfig(
  id: number,
  params: { roundOpensAt?: Date; roundClosesAt?: Date; prelimsTopN?: number; playoffsWinnerCount?: number }
): Promise<EventRow | null> {
  const result = await pool.query<EventRow>(
    `UPDATE events
     SET round_opens_at = COALESCE($2, round_opens_at),
         round_closes_at = COALESCE($3, round_closes_at),
         prelims_top_n = COALESCE($4, prelims_top_n),
         playoffs_winner_count = COALESCE($5, playoffs_winner_count)
     WHERE id = $1
     RETURNING *`,
    [id, params.roundOpensAt ?? null, params.roundClosesAt ?? null, params.prelimsTopN ?? null, params.playoffsWinnerCount ?? null]
  );
  return result.rows[0] ?? null;
}
