import { pool } from "../../db/pool.js";

export interface NotificationRow {
  id: number;
  event_id: number;
  event_player_id: number;
  type: "ADVANCED" | "ADMIN_MESSAGE";
  title: string;
  body: string;
  created_by_admin_label: string | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export async function insertNotification(params: {
  eventId: number;
  eventPlayerId: number;
  type: "ADVANCED" | "ADMIN_MESSAGE";
  title: string;
  body: string;
  createdByAdminLabel: string;
}): Promise<NotificationRow> {
  const result = await pool.query<NotificationRow>(
    `INSERT INTO notifications (event_id, event_player_id, type, title, body, created_by_admin_label)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [params.eventId, params.eventPlayerId, params.type, params.title, params.body, params.createdByAdminLabel]
  );
  return result.rows[0];
}

export async function markNotificationDelivered(id: number): Promise<void> {
  await pool.query(`UPDATE notifications SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL`, [id]);
}

export async function listNotificationsForPlayer(eventPlayerId: number, limit = 50): Promise<NotificationRow[]> {
  const result = await pool.query<NotificationRow>(
    `SELECT * FROM notifications WHERE event_player_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [eventPlayerId, limit]
  );
  return result.rows;
}

export async function markNotificationRead(id: number, eventPlayerId: number): Promise<void> {
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND event_player_id = $2 AND read_at IS NULL`,
    [id, eventPlayerId]
  );
}

export async function listDeliveryStatusForEvent(
  eventId: number,
  createdAfter: Date
): Promise<Array<{ event_player_id: number; delivered_at: string | null }>> {
  const result = await pool.query<{ event_player_id: number; delivered_at: string | null }>(
    `SELECT event_player_id, delivered_at FROM notifications WHERE event_id = $1 AND created_at >= $2`,
    [eventId, createdAfter]
  );
  return result.rows;
}
