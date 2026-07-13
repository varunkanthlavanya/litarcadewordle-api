import { Router } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
import { createFixedWindowRateLimiter } from "../../middleware/rateLimit.js";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { InvalidSecretKeyError, loginAdmin, logoutAdmin } from "./authAdmin.service.js";

const loginSchema = z.object({
  secretKey: z.string().min(1),
  nameLabel: z.string().min(1).max(100),
});

const loginRateLimiter = createFixedWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  keyFn: (req) => req.ip ?? "unknown",
  message: "Too many login attempts. Try again later.",
});

const COOKIE_NAME = "admin_token";

export const authAdminRouter = Router();

authAdminRouter.post("/login", loginRateLimiter, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "secretKey and nameLabel are required" });
    return;
  }

  try {
    const { token, expiresAt, nameLabel } = await loginAdmin({
      secretKey: parsed.data.secretKey,
      nameLabel: parsed.data.nameLabel,
      ipAddress: req.ip ?? null,
    });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });

    res.status(200).json({ nameLabel, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof InvalidSecretKeyError) {
      res.status(401).json({ error: "Invalid secret key" });
      return;
    }
    throw err;
  }
}));

authAdminRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (token) {
      await logoutAdmin(token);
    }
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.status(200).json({ ok: true });
  })
);

authAdminRouter.get("/me", asyncHandler(requireAdminAuth), (req, res) => {
  res.status(200).json({ nameLabel: req.admin?.nameLabel });
});
