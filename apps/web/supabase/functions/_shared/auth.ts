import { supabaseAdmin } from "./supabaseAdmin.ts";
import { hashToken } from "./tokens.ts";

export interface AdminIdentity {
  adminSessionId: number;
  nameLabel: string;
}

export interface PlayerIdentity {
  eventPlayerId: number;
  eventId: number;
  mobileNumber: string;
  displayName: string | null;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

/** Port of authAdmin.service.ts's resolveAdminToken. */
export async function resolveAdminToken(token: string): Promise<AdminIdentity | null> {
  const tokenHash = await hashToken(token);
  const { data: session } = await supabaseAdmin()
    .from("wl_admin_sessions")
    .select("id, name_label, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  return { adminSessionId: session.id, nameLabel: session.name_label };
}

/** Port of authPlayer.service.ts's resolvePlayerToken (incl. the last_seen_at touch). */
export async function resolvePlayerToken(token: string): Promise<PlayerIdentity | null> {
  const tokenHash = await hashToken(token);
  const db = supabaseAdmin();

  const { data: session } = await db
    .from("wl_player_login_sessions")
    .select("event_player_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  await db.from("wl_player_login_sessions").update({ last_seen_at: new Date().toISOString() }).eq("token_hash", tokenHash);

  const { data: eventPlayer } = await db
    .from("wl_event_players")
    .select("id, event_id, mobile_number, display_name")
    .eq("id", session.event_player_id)
    .maybeSingle();

  if (!eventPlayer) return null;

  return {
    eventPlayerId: eventPlayer.id,
    eventId: eventPlayer.event_id,
    mobileNumber: eventPlayer.mobile_number,
    displayName: eventPlayer.display_name,
  };
}

export async function requireAdmin(req: Request): Promise<AdminIdentity> {
  const token = bearerToken(req);
  if (!token) throw new AuthError("Not authenticated");
  const identity = await resolveAdminToken(token);
  if (!identity) throw new AuthError("Not authenticated");
  return identity;
}

export async function requirePlayer(req: Request): Promise<PlayerIdentity> {
  const token = bearerToken(req);
  if (!token) throw new AuthError("Not authenticated");
  const identity = await resolvePlayerToken(token);
  if (!identity) throw new AuthError("Not authenticated");
  return identity;
}

export class AuthError extends Error {
  status = 401;
}
