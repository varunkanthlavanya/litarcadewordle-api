import { Router } from "express";
import { z } from "zod";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { requirePlayerAuth } from "../../middleware/requirePlayerAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { writeAuditEntry } from "../audit/audit.service.js";
import type { NotificationsService } from "./notifications.service.js";

export function createNotificationsAdminRouter(service: NotificationsService): Router {
  const router = Router();
  router.use(asyncHandler(requireAdminAuth));

  const sendSchema = z.object({
    recipients: z.union([z.literal("all"), z.array(z.number().int().positive()).min(1)]),
    type: z.enum(["ADVANCED", "ADMIN_MESSAGE"]).default("ADMIN_MESSAGE"),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
  });

  router.post(
    "/:eventId/notifications",
    asyncHandler(async (req, res) => {
      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "recipients ('all' or player ids), title, and body are required" });
        return;
      }

      const eventId = Number(req.params.eventId);
      const adminLabel = req.admin!.nameLabel;
      const { recipients, type, title, body } = parsed.data;

      const results =
        recipients === "all"
          ? await service.sendToAllInEvent({ eventId, type, title, body, adminLabel })
          : await service.sendToMany({ eventId, eventPlayerIds: recipients, type, title, body, adminLabel });

      await writeAuditEntry({
        adminLabel,
        eventId,
        actionType: "NOTIFICATION_SENT",
        targetType: "event_player",
        targetIds: recipients,
        metadata: { title, recipientCount: results.length },
      });

      res.status(200).json({ results });
    })
  );

  return router;
}

export function createNotificationsPlayerRouter(service: NotificationsService): Router {
  const router = Router();
  router.use(asyncHandler(requirePlayerAuth));

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.status(200).json(await service.listForPlayer(req.player!.eventPlayerId));
    })
  );

  router.post(
    "/:id/read",
    asyncHandler(async (req, res) => {
      await service.markRead(Number(req.params.id), req.player!.eventPlayerId);
      res.status(200).json({ ok: true });
    })
  );

  return router;
}
