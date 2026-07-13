import { Router } from "express";
import { z } from "zod";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import type { NotificationsService } from "../notifications/notifications.service.js";
import { confirmCutoff, CutoffServiceError, getCutoffPreview } from "./cutoff.service.js";

export function createCutoffAdminRouter(notifications: NotificationsService): Router {
  const router = Router();
  router.use(asyncHandler(requireAdminAuth));

  router.get(
    "/:eventId/cutoff/preview",
    asyncHandler(async (req, res) => {
      const topN = Number(req.query.topN ?? 20);
      try {
        res.status(200).json(await getCutoffPreview(Number(req.params.eventId), topN));
      } catch (err) {
        if (err instanceof CutoffServiceError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  const confirmSchema = z.object({ eventPlayerIds: z.array(z.number().int().positive()).min(1) });

  router.post(
    "/:eventId/cutoff/confirm",
    asyncHandler(async (req, res) => {
      const parsed = confirmSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "eventPlayerIds array is required" });
        return;
      }
      try {
        const result = await confirmCutoff({
          eventId: Number(req.params.eventId),
          eventPlayerIds: parsed.data.eventPlayerIds,
          adminLabel: req.admin!.nameLabel,
          notifications,
        });
        res.status(200).json(result);
      } catch (err) {
        if (err instanceof CutoffServiceError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  return router;
}
