import { Router } from "express";
import { z } from "zod";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { requirePlayerAuth } from "../../middleware/requirePlayerAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import {
  adminCreatePuzzle,
  adminSetPuzzleStatus,
  getLeaderboard,
  getPlayerRoundStatus,
  getSessionMonitor,
  TimedWordleServiceError,
} from "./tw.service.js";
import { findPuzzleByEventId } from "./tw.repo.js";

export const timedWordleAdminRouter = Router();
timedWordleAdminRouter.use(asyncHandler(requireAdminAuth));

const createPuzzleSchema = z.object({
  secretWord: z.string().length(5),
  definition: z.string().max(2000).optional(),
});

timedWordleAdminRouter.post(
  "/:eventId/timed-wordle/puzzle",
  asyncHandler(async (req, res) => {
    const parsed = createPuzzleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "secretWord (5 letters) is required" });
      return;
    }
    try {
      const puzzle = await adminCreatePuzzle({
        eventId: Number(req.params.eventId),
        secretWord: parsed.data.secretWord,
        definition: parsed.data.definition,
        adminLabel: req.admin!.nameLabel,
      });
      res.status(201).json(puzzle);
    } catch (err) {
      if (err instanceof TimedWordleServiceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

const statusSchema = z.object({ status: z.enum(["SCHEDULED", "OPEN", "CLOSED"]) });

timedWordleAdminRouter.post(
  "/:eventId/timed-wordle/puzzle/status",
  asyncHandler(async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "status must be SCHEDULED, OPEN, or CLOSED" });
      return;
    }
    const eventId = Number(req.params.eventId);
    const puzzle = await findPuzzleByEventId(eventId);
    if (!puzzle) {
      res.status(404).json({ error: "No Timed Wordle puzzle exists for this event yet" });
      return;
    }
    await adminSetPuzzleStatus(puzzle.id, eventId, parsed.data.status, req.admin!.nameLabel);
    res.status(200).json({ ok: true });
  })
);

timedWordleAdminRouter.get(
  "/:eventId/timed-wordle/leaderboard",
  asyncHandler(async (req, res) => {
    const puzzle = await findPuzzleByEventId(Number(req.params.eventId));
    if (!puzzle) {
      res.status(404).json({ error: "No Timed Wordle puzzle exists for this event yet" });
      return;
    }
    res.status(200).json(await getLeaderboard(puzzle.id));
  })
);

timedWordleAdminRouter.get(
  "/:eventId/timed-wordle/puzzle",
  asyncHandler(async (req, res) => {
    const puzzle = await findPuzzleByEventId(Number(req.params.eventId));
    if (!puzzle) {
      res.status(404).json({ error: "No Timed Wordle puzzle exists for this event yet" });
      return;
    }
    res.status(200).json(puzzle);
  })
);

timedWordleAdminRouter.get(
  "/:eventId/timed-wordle/sessions",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getSessionMonitor(Number(req.params.eventId)));
  })
);

export const timedWordlePlayerRouter = Router();
timedWordlePlayerRouter.use(asyncHandler(requirePlayerAuth));

timedWordlePlayerRouter.get(
  "/:eventId/timed-wordle/status",
  asyncHandler(async (req, res) => {
    const status = await getPlayerRoundStatus({
      eventId: Number(req.params.eventId),
      eventPlayerId: req.player!.eventPlayerId,
    });
    res.status(200).json(status);
  })
);

timedWordlePlayerRouter.get(
  "/:eventId/timed-wordle/leaderboard",
  asyncHandler(async (req, res) => {
    const puzzle = await findPuzzleByEventId(Number(req.params.eventId));
    if (!puzzle) {
      res.status(404).json({ error: "No Timed Wordle puzzle exists for this event yet" });
      return;
    }
    res.status(200).json(await getLeaderboard(puzzle.id));
  })
);
