import type { Request, Response, NextFunction } from "express";
import { resolveAdminToken, type AdminIdentity } from "../modules/auth-admin/authAdmin.service.js";

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminIdentity;
  }
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.admin_token as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }

  const identity = await resolveAdminToken(token);
  if (!identity) {
    res.status(401).json({ error: "Admin session invalid or expired" });
    return;
  }

  req.admin = identity;
  next();
}
