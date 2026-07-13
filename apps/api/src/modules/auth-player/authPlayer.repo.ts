import { pool } from "../../db/pool.js";

export interface PlayerLoginSessionRow {
  id: number;
  event_player_id: number;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export async function insertPlayerLoginSession(params: {
  eventPlayerId: number;
  tokenHash: string;
  expiresAt: Date;
}): Promise<PlayerLoginSessionRow> {
  const result = await pool.query<PlayerLoginSessionRow>(
    `INSERT INTO player_login_sessions (event_player_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [params.eventPlayerId, params.tokenHash, params.expiresAt]
  );
  return result.rows[0];
}

export async function findPlayerSessionByTokenHash(tokenHash: string): Promise<PlayerLoginSessionRow | null> {
  const result = await pool.query<PlayerLoginSessionRow>(
    `SELECT * FROM player_login_sessions WHERE token_hash = $1`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

export async function touchPlayerSession(tokenHash: string): Promise<void> {
  await pool.query(`UPDATE player_login_sessions SET last_seen_at = now() WHERE token_hash = $1`, [tokenHash]);
}

export async function revokePlayerSession(tokenHash: string): Promise<void> {
  await pool.query(
    `UPDATE player_login_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}

export async function revokeAllSessionsForPlayer(eventPlayerId: number): Promise<void> {
  await pool.query(
    `UPDATE player_login_sessions SET revoked_at = now() WHERE event_player_id = $1 AND revoked_at IS NULL`,
    [eventPlayerId]
  );
}
