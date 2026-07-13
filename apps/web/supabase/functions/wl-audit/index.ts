// Port of apps/api/src/modules/audit/{audit.routes,audit.service,audit.repo}.ts
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, AuthError } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const eventId = Number(segments[1]);
  const db = supabaseAdmin();

  try {
    await requireAdmin(req);
    if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);
    if (req.method !== "GET") return json(req, { error: "Not found" }, 404);

    const { data: rows, error } = await db
      .from("wl_audit_log")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return json(req, rows ?? []);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-audit error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
