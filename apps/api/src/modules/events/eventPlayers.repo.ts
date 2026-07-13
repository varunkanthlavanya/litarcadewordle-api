import { pool } from "../../db/pool.js";

export interface EventPlayerRow {
  id: number;
  event_id: number;
  mobile_number: string;
  display_name: string | null;
  created_at: string;
}

const MAX_COHORT_SIZE = 600;

export class CohortTooLargeError extends Error {
  constructor() {
    super(`Cohort cannot exceed ${MAX_COHORT_SIZE} players`);
    this.name = "CohortTooLargeError";
  }
}

export async function bulkInsertPlayers(
  eventId: number,
  players: Array<{ mobileNumber: string; displayName?: string }>
): Promise<EventPlayerRow[]> {
  if (players.length > MAX_COHORT_SIZE) {
    throw new CohortTooLargeError();
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted: EventPlayerRow[] = [];
    for (const player of players) {
      const result = await client.query<EventPlayerRow>(
        `INSERT INTO event_players (event_id, mobile_number, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, mobile_number) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING *`,
        [eventId, player.mobileNumber.trim(), player.displayName?.trim() ?? null]
      );
      inserted.push(result.rows[0]);
    }
    await client.query("COMMIT");
    return inserted;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function findEventPlayerByMobile(eventId: number, mobileNumber: string): Promise<EventPlayerRow | null> {
  const result = await pool.query<EventPlayerRow>(
    `SELECT * FROM event_players WHERE event_id = $1 AND mobile_number = $2`,
    [eventId, mobileNumber.trim()]
  );
  return result.rows[0] ?? null;
}

export async function findEventPlayerById(id: number): Promise<EventPlayerRow | null> {
  const result = await pool.query<EventPlayerRow>(`SELECT * FROM event_players WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listEventPlayers(eventId: number): Promise<EventPlayerRow[]> {
  const result = await pool.query<EventPlayerRow>(
    `SELECT * FROM event_players WHERE event_id = $1 ORDER BY created_at ASC`,
    [eventId]
  );
  return result.rows;
}

export async function countEventPlayers(eventId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM event_players WHERE event_id = $1`,
    [eventId]
  );
  return Number(result.rows[0].count);
}
