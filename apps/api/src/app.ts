import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config/index.js";
import { authAdminRouter } from "./modules/auth-admin/authAdmin.routes.js";
import { authPlayerRouter } from "./modules/auth-player/authPlayer.routes.js";
import { eventsRouter } from "./modules/events/events.routes.js";
import { timedWordleAdminRouter, timedWordlePlayerRouter } from "./modules/timed-wordle/tw.routes.js";
import { unwordleAdminRouter, unwordlePlayerRouter } from "./modules/unwordle/uw.routes.js";
import { winnersAdminRouter } from "./modules/winners/winners.routes.js";
import { auditAdminRouter } from "./modules/audit/audit.routes.js";

/** Base app with routes that don't depend on the websocket/io layer. Callers must
 * mount any io-dependent routers (e.g. notifications) before calling `finalizeApp`,
 * since the 404/error handlers it adds must stay last in the middleware stack. */
export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin not allowed: ${origin}`));
        }
      },
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", nodeEnv: config.nodeEnv });
  });

  app.use("/admin/auth", authAdminRouter);
  app.use("/admin/events", eventsRouter);
  app.use("/admin/events", timedWordleAdminRouter);
  app.use("/admin/events", unwordleAdminRouter);
  app.use("/admin/events", winnersAdminRouter);
  app.use("/admin/events", auditAdminRouter);
  app.use("/player/auth", authPlayerRouter);
  app.use("/player/events", timedWordlePlayerRouter);
  app.use("/player/events", unwordlePlayerRouter);

  return app;
}

/** Adds the catch-all 404 and global error handler — call once, after every
 * router (including io-dependent ones) has been mounted. */
export function finalizeApp(app: Express): void {
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Every async route/middleware is wrapped with asyncHandler (see shared/asyncHandler.ts)
  // so unexpected rejections (e.g. a DB outage) land here as a clean 500 instead of
  // hanging the request or crashing the process.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled request error", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });
}
