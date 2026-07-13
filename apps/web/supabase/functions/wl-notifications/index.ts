// Port of apps/api/src/modules/notifications/{notifications.routes,notifications.service,notifications.repo}.ts
//
// Path layout: wl-notifications/admin/<eventId>/send and wl-notifications/player/(list|<id>/read).
// "Live vs queued" delivery status relied on Socket.IO presence; approximated
// here via wl_player_login_sessions.last_seen_at (kept fresh by every
// requirePlayer call regardless of which game screen the player is on) —
// notifications themselves are always persisted and picked up by the
// player's own polling either way, so this only affects the admin's
// delivery-status badge, not whether the notification actually arrives.
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, requirePlayer, AuthError } from "../_shared/auth.ts";
import { writeAuditEntry } from "../_shared/audit.ts";

const ONLINE_WINDOW_MS = 60_000;

async function isPlayerOnline(db: ReturnType<typeof supabaseAdmin>, eventPlayerId: number): Promise<boolean> {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("wl_player_login_sessions")
    .select("id", { count: "exact", head: true })
    .eq("event_player_id", eventPlayerId)
    .gte("last_seen_at", since);
  return (count ?? 0) > 0;
}

async function sendToOne(
  db: ReturnType<typeof supabaseAdmin>,
  params: { eventId: number; eventPlayerId: number; type: string; title: string; body: string; adminLabel: string }
) {
  const { data: row, error } = await db
    .from("wl_notifications")
    .insert({
      event_id: params.eventId,
      event_player_id: params.eventPlayerId,
      type: params.type,
      title: params.title,
      body: params.body,
      created_by_admin_label: params.adminLabel,
    })
    .select("*")
    .single();
  if (error) throw error;

  const online = await isPlayerOnline(db, params.eventPlayerId);
  if (online) {
    await db.from("wl_notifications").update({ delivered_at: new Date().toISOString() }).eq("id", row.id);
  }

  return { eventPlayerId: params.eventPlayerId, status: online ? "live" : "queued", notificationId: row.id };
}

function toDto(row: { id: number; type: string; title: string; body: string; created_at: string; read_at: string | null }) {
  return { id: row.id, type: row.type, title: row.title, body: row.body, createdAt: row.created_at, readAt: row.read_at };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const rest = segments.slice(1); // drop "wl-notifications"
  const audience = rest[0];
  const db = supabaseAdmin();

  try {
    if (audience === "admin") {
      const admin = await requireAdmin(req);
      const eventId = Number(rest[1]);
      if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);
      if (req.method !== "POST") return json(req, { error: "Not found" }, 404);

      const body = await req.json().catch(() => ({}));
      const recipients = body.recipients;
      const type = body.type === "ADVANCED" ? "ADVANCED" : "ADMIN_MESSAGE";
      const title = typeof body.title === "string" ? body.title : "";
      const notifBody = typeof body.body === "string" ? body.body : "";
      if (!title || !notifBody || (recipients !== "all" && !Array.isArray(recipients))) {
        return json(req, { error: "recipients ('all' or player ids), title, and body are required" }, 400);
      }

      let eventPlayerIds: number[];
      if (recipients === "all") {
        const { data: cohort } = await db.from("wl_event_players").select("id").eq("event_id", eventId);
        eventPlayerIds = (cohort ?? []).map((p) => p.id);
      } else {
        eventPlayerIds = recipients;
      }

      const results = [];
      for (const eventPlayerId of eventPlayerIds) {
        results.push(await sendToOne(db, { eventId, eventPlayerId, type, title, body: notifBody, adminLabel: admin.nameLabel }));
      }

      await writeAuditEntry(db, {
        adminLabel: admin.nameLabel,
        eventId,
        actionType: "NOTIFICATION_SENT",
        targetType: "event_player",
        targetIds: recipients,
        metadata: { title, recipientCount: results.length },
      });

      return json(req, { results });
    }

    if (audience === "player") {
      const player = await requirePlayer(req);

      if (rest[1] === "list" && req.method === "GET") {
        const { data: rows, error } = await db
          .from("wl_notifications")
          .select("*")
          .eq("event_player_id", player.eventPlayerId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json(req, (rows ?? []).map(toDto));
      }

      if (rest[2] === "read" && req.method === "POST") {
        const notificationId = Number(rest[1]);
        await db
          .from("wl_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", notificationId)
          .eq("event_player_id", player.eventPlayerId);
        return json(req, { ok: true });
      }

      return json(req, { error: "Not found" }, 404);
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-notifications error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
