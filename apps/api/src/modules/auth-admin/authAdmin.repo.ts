import { pool } from "../../db/pool.js";

export interface AdminSessionRow {
  id: number;
  token_hash: string;
  name_label: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip_address: string | null;
}

export async function insertAdminSession(params: {
  tokenHash: string;
  nameLabel: string;
  expiresAt: Date;
  ipAddress: string | null;
}): Promise<AdminSessionRow> {
  const result = await pool.query<AdminSessionRow>(
    `INSERT INTO admin_sessions (token_hash, name_label, expires_at, ip_address)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.tokenHash, params.nameLabel, params.expiresAt, params.ipAddress]
  );
  return result.rows[0];
}

export async function findAdminSessionByTokenHash(tokenHash: string): Promise<AdminSessionRow | null> {
  const result = await pool.query<AdminSessionRow>(
    `SELECT * FROM admin_sessions WHERE token_hash = $1`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

export async function revokeAdminSession(tokenHash: string): Promise<void> {
  await pool.query(
    `UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}
