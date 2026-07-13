import { Router } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
import { createFixedWindowRateLimiter } from "../../middleware/rateLimit.js";
import { requirePlayerAuth } from "../../middleware/requirePlayerAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { loginPlayer, logoutPlayer, PlayerNotOnCohortError } from "./authPlayer.service.js";

const COOKIE_NAME = "player_token";

const loginSchema = z.object({
  eventId: z.number().int().positive(),
  mobileNumber: z.string().min(6).max(20),
});

const loginRateLimiter = createFixedWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 20,
  keyFn: (req) => req.ip ?? "unknown",
  message: "Too many login attempts. Try again later.",
});

export const authPlayerRouter = Router();

authPlayerRouter.post(
  "/login",
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "eventId and mobileNumber are required" });
      return;
    }

    try {
      const { token, expiresAt, player } = await loginPlayer(parsed.data);
      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.nodeEnv === "production",
        sameSite: "lax",
        expires: expiresAt,
        path: "/",
      });
      res.status(200).json({ player });
    } catch (err) {
      if (err instanceof PlayerNotOnCohortError) {
        res.status(401).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

authPlayerRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (token) await logoutPlayer(token);
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.status(200).json({ ok: true });
  })
);

authPlayerRouter.get("/me", asyncHandler(requirePlayerAuth), (req, res) => {
  res.status(200).json({ player: req.player });
});
