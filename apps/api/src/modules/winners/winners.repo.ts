import { pool } from "../../db/pool.js";

export interface EventWinnerRow {
  id: number;
  event_id: number;
  event_player_id: number;
  place: number;
  created_at: string;
}

export async function replaceWinners(
  eventId: number,
  winners: Array<{ eventPlayerId: number; place: number }>
): Promise<EventWinnerRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM event_winners WHERE event_id = $1`, [eventId]);
    const rows: EventWinnerRow[] = [];
    for (const w of winners) {
      const result = await client.query<EventWinnerRow>(
        `INSERT INTO event_winners (event_id, event_player_id, place) VALUES ($1, $2, $3) RETURNING *`,
        [eventId, w.eventPlayerId, w.place]
      );
      rows.push(result.rows[0]);
    }
    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listWinners(eventId: number): Promise<EventWinnerRow[]> {
  const result = await pool.query<EventWinnerRow>(
    `SELECT * FROM event_winners WHERE event_id = $1 ORDER BY place ASC`,
    [eventId]
  );
  return result.rows;
}
