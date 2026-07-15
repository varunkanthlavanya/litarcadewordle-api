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
      if (!Number.isInteger(eventId) || eventId <= 0 || mobileNumber.length !== 10) {
        return json(req, { error: "eventId and mobileNumber are required" }, 400);
      }

      const db = supabaseAdmin();
      const { data: eventPlayer } = await db
        .from("wl_event_players")
        .select("id, event_id, mobile_number, display_name")
        .eq("event_id", eventId)
        .eq("mobile_number", mobileNumber)
        .maybeSingle();

      if (!eventPlayer) {
        return json(req, { error: "This mobile number is not on the whitelist for this event" }, 401);
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
