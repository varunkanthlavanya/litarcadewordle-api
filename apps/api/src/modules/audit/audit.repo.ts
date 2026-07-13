import { pool } from "../../db/pool.js";

export interface AuditLogRow {
  id: number;
  admin_label: string;
  event_id: number | null;
  action_type: string;
  target_type: string | null;
  target_ids: unknown;
  reason: string | null;
  metadata: unknown;
  created_at: string;
}

export async function insertAuditEntry(params: {
  adminLabel: string;
  eventId: number | null;
  actionType: string;
  targetType?: string | null;
  targetIds?: unknown;
  reason?: string | null;
  metadata?: unknown;
}): Promise<AuditLogRow> {
  const result = await pool.query<AuditLogRow>(
    `INSERT INTO audit_log (admin_label, event_id, action_type, target_type, target_ids, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.adminLabel,
      params.eventId,
      params.actionType,
      params.targetType ?? null,
      params.targetIds !== undefined ? JSON.stringify(params.targetIds) : null,
      params.reason ?? null,
      params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
    ]
  );
  return result.rows[0];
}

export async function listAuditEntries(eventId?: number): Promise<AuditLogRow[]> {
  if (eventId !== undefined) {
    const result = await pool.query<AuditLogRow>(
      `SELECT * FROM audit_log WHERE event_id = $1 ORDER BY created_at DESC`,
      [eventId]
    );
    return result.rows;
  }
  const result = await pool.query<AuditLogRow>(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500`);
  return result.rows;
}
