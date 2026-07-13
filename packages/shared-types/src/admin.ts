export interface AdminLoginRequest {
  secretKey: string;
  nameLabel: string;
}

export interface AdminSessionInfo {
  nameLabel: string;
  issuedAt: string;
  expiresAt: string;
}

export interface AuditLogEntry {
  id: number;
  adminLabel: string;
  eventId: number | null;
  actionType: string;
  targetType: string | null;
  targetIds: unknown;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

/** Matches the raw row shape actually returned by /admin/events/:id/audit
 * (snake_case, mirrors the Postgres columns directly — see audit.repo.ts AuditLogRow). */
export interface AuditLogApiRow {
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

export interface EventWinnerApiRow {
  id: number;
  event_id: number;
  event_player_id: number;
  place: number;
  created_at: string;
}
