// Port of apps/api/src/modules/winners/{winners.routes,winners.service,winners.repo}.ts
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, AuthError } from "../_shared/auth.ts";
import { writeAuditEntry } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const eventId = Number(segments[1]);
  const db = supabaseAdmin();

  try {
    const admin = await requireAdmin(req);
    if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const winners: Array<{ eventPlayerId: number; place: number }> = Array.isArray(body.winners) ? body.winners : [];

      await db.from("wl_event_winners").delete().eq("event_id", eventId);
      const { data: rows, error } = await db
        .from("wl_event_winners")
        .insert(winners.map((w) => ({ event_id: eventId, event_player_id: w.eventPlayerId, place: w.place })))
        .select("*");
      if (error) throw error;

      await writeAuditEntry(db, {
        adminLabel: admin.nameLabel,
        eventId,
        actionType: "WINNERS_SAVED",
        targetType: "event_player",
        targetIds: winners.map((w) => w.eventPlayerId),
        metadata: { winners },
      });
      return json(req, rows ?? []);
    }

    if (req.method === "GET") {
      const { data: rows, error } = await db.from("wl_event_winners").select("*").eq("event_id", eventId).order("place", { ascending: true });
      if (error) throw error;
      return json(req, rows ?? []);
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-winners error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
