import type { Request, Response, NextFunction } from "express";
import { resolvePlayerToken, type PlayerIdentity } from "../modules/auth-player/authPlayer.service.js";

declare module "express-serve-static-core" {
  interface Request {
    player?: PlayerIdentity;
  }
}

export async function requirePlayerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.player_token as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Player authentication required" });
    return;
  }

  const identity = await resolvePlayerToken(token);
  if (!identity) {
    res.status(401).json({ error: "Player session invalid or expired" });
    return;
  }

  req.player = identity;
  next();
}
