import { Router } from "express";
import { z } from "zod";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { getWinners, saveWinners } from "./winners.service.js";

export const winnersAdminRouter = Router();
winnersAdminRouter.use(asyncHandler(requireAdminAuth));

const saveSchema = z.object({
  winners: z.array(z.object({ eventPlayerId: z.number().int().positive(), place: z.number().int().min(1).max(5) })),
});

winnersAdminRouter.post(
  "/:eventId/winners",
  asyncHandler(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "winners array of {eventPlayerId, place} is required" });
      return;
    }
    const rows = await saveWinners(Number(req.params.eventId), parsed.data.winners, req.admin!.nameLabel);
    res.status(200).json(rows);
  })
);

winnersAdminRouter.get(
  "/:eventId/winners",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getWinners(Number(req.params.eventId)));
  })
);
