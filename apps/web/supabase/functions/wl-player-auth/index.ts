// Port of apps/api/src/modules/auth-player/{authPlayer.routes,authPlayer.service}.ts
// Handles: POST .../login, POST .../logout, GET .../me
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { generateToken, hashToken } from "../_shared/tokens.ts";
import { requirePlayer, AuthError } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const PLAYER_SESSION_TTL_HOURS = Number(Deno.env.get("PLAYER_SESSION_TTL_HOURS") ?? "6");

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const pathname = new URL(req.url).pathname;
  const action = pathname.split("/").pop();

  try {
    if (action === "login" && req.method === "POST") {
      const ip = clientIp(req);
      const allowed = await checkRateLimit({ ipAddress: ip, windowMs: 15 * 60 * 1000, maxAttempts: 20 });
      if (!allowed) return json(req, { error: "Too many login attempts. Try again later." }, 429);

      const body = await req.json().catch(() => ({}));
      const eventId = Number(body.eventId);
      // Same normalization rule as cohort upload: strip everything but
      // digits and keep the last 10, so "+91 8220 850 225" and "8220850225"
      // match the same whitelisted row regardless of how either was entered.
      const rawMobileNumber = typeof body.mobileNumber === "string" ? body.mobileNumber : "";
      const digits = rawMobileNumber.replace(/\D/g, "");
      const mobileNumber = digits.length > 10 ? digits.slice(-10) : digits;

      // `field` tells the client which of the two inputs the error actually
      // belongs to, so "wrong event ID" and "number not on the whitelist"
      // read as distinct, correctly-targeted messages instead of one vague
      // failure that could mean either.
      if (!Number.isInteger(eventId) || eventId <= 0) {
        return json(req, { error: "Enter a valid event ID", field: "eventId" }, 400);
      }
      if (mobileNumber.length !== 10) {
        return json(req, { error: "Enter a valid 10-digit mobile number", field: "mobileNumber" }, 400);
      }

      const db = supabaseAdmin();

      const { data: event } = await db.from("wl_events").select("id").eq("id", eventId).maybeSingle();
      if (!event) {
        return json(req, { error: "Event ID not found", field: "eventId" }, 404);
      }

      // Matched by normalizing the STORED value too, not just a straight
      // .eq() on mobile_number — cohorts uploaded before normalization
      // existed (or before a backfill migration has actually run against
      // this project) can still have raw "+91 8220 850 225"-style values on
      // disk. Cohort size is capped at 600, so fetching per-event and
      // comparing in JS is cheap and makes login correct regardless of
      // what's actually stored, rather than depending on upload-time or
      // backfill normalization having already happened.
      const { data: eventPlayers } = await db
        .from("wl_event_players")
        .select("id, event_id, mobile_number, display_name")
        .eq("event_id", eventId);

      const eventPlayer = eventPlayers?.find((p) => {
        const storedDigits = String(p.mobile_number ?? "").replace(/\D/g, "");
        const storedNormalized = storedDigits.length > 10 ? storedDigits.slice(-10) : storedDigits;
        return storedNormalized === mobileNumber;
      });

      if (!eventPlayer) {
        return json(req, { error: "This mobile number is not on the whitelist for this event", field: "mobileNumber" }, 401);
      }

      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + PLAYER_SESSION_TTL_HOURS * 60 * 60 * 1000);

      const { error } = await db.from("wl_player_login_sessions").insert({
        event_player_id: eventPlayer.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      });
      if (error) throw error;

      return json(req, {
        token,
        player: {
          eventPlayerId: eventPlayer.id,
          eventId: eventPlayer.event_id,
          mobileNumber: eventPlayer.mobile_number,
          displayName: eventPlayer.display_name,
        },
      });
    }

    if (action === "logout" && req.method === "POST") {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.match(/^Bearer (.+)$/i)?.[1];
      if (token) {
        const tokenHash = await hashToken(token);
        await supabaseAdmin()
          .from("wl_player_login_sessions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("token_hash", tokenHash)
          .is("revoked_at", null);
      }
      return json(req, { ok: true });
    }

    if (action === "me" && req.method === "GET") {
      const identity = await requirePlayer(req);
      return json(req, { player: identity });
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-player-auth error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
