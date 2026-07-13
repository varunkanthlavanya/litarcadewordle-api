// Port of apps/api/src/modules/auth-admin/{authAdmin.routes,authAdmin.service,authAdmin.repo}.ts
// Handles: POST .../login, POST .../logout, GET .../me
//
// Cookies -> bearer token: the Lovable app origin and this function's origin
// are cross-origin, so instead of an httpOnly cookie, login returns the token
// in the JSON body; the frontend stores it and sends it back as
// `Authorization: Bearer <token>` on every subsequent call (see requireAdmin
// in _shared/auth.ts).
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { generateToken, hashToken, safeStringEqual } from "../_shared/tokens.ts";
import { requireAdmin, AuthError } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const ADMIN_SESSION_TTL_HOURS = Number(Deno.env.get("ADMIN_SESSION_TTL_HOURS") ?? "12");

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
      const allowed = await checkRateLimit({ ipAddress: ip, windowMs: 15 * 60 * 1000, maxAttempts: 5 });
      if (!allowed) return json(req, { error: "Too many login attempts. Try again later." }, 429);

      const body = await req.json().catch(() => ({}));
      const secretKey = typeof body.secretKey === "string" ? body.secretKey : "";
      const nameLabelRaw = typeof body.nameLabel === "string" ? body.nameLabel : "";
      if (!secretKey || !nameLabelRaw) {
        return json(req, { error: "secretKey and nameLabel are required" }, 400);
      }

      if (!safeStringEqual(secretKey, Deno.env.get("ADMIN_SECRET_KEY") ?? "")) {
        return json(req, { error: "Invalid secret key" }, 401);
      }

      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000);
      const nameLabel = nameLabelRaw.trim().slice(0, 100);

      const { error } = await supabaseAdmin().from("wl_admin_sessions").insert({
        token_hash: tokenHash,
        name_label: nameLabel,
        expires_at: expiresAt.toISOString(),
        ip_address: ip,
      });
      if (error) throw error;

      return json(req, { token, nameLabel, expiresAt: expiresAt.toISOString() });
    }

    if (action === "logout" && req.method === "POST") {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.match(/^Bearer (.+)$/i)?.[1];
      if (token) {
        const tokenHash = await hashToken(token);
        await supabaseAdmin()
          .from("wl_admin_sessions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("token_hash", tokenHash)
          .is("revoked_at", null);
      }
      return json(req, { ok: true });
    }

    if (action === "me" && req.method === "GET") {
      const identity = await requireAdmin(req);
      return json(req, { nameLabel: identity.nameLabel });
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-admin-auth error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
