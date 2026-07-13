import { Router } from "express";
import { z } from "zod";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { requirePlayerAuth } from "../../middleware/requirePlayerAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import {
  adminCreatePuzzle,
  adminSetPuzzleStatus,
  checkPuzzlePatterns,
  ensurePlayerSession,
  getLeaderboard,
  getPlayerRoundStatus,
  getSessionMonitor,
  UnwordleServiceError,
} from "./uw.service.js";
import { findPuzzleByEventId } from "./uw.repo.js";

const tileColorSchema = z.enum(["GREEN", "YELLOW", "GRAY"]);
const rowPatternSchema = z.array(tileColorSchema).length(5);

export const unwordleAdminRouter = Router();
unwordleAdminRouter.use(asyncHandler(requireAdminAuth));

const createPuzzleSchema = z.object({
  solutionWord: z.string().length(5),
  rowPatterns: z.array(rowPatternSchema).length(4),
});

unwordleAdminRouter.post(
  "/:eventId/unwordle/puzzle",
  asyncHandler(async (req, res) => {
    const parsed = createPuzzleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "solutionWord (5 letters) and 4 row patterns of 5 tiles each are required" });
      return;
    }
    try {
      const { puzzle, validation } = await adminCreatePuzzle({
        eventId: Number(req.params.eventId),
        solutionWord: parsed.data.solutionWord,
        rowPatterns: parsed.data.rowPatterns,
        adminLabel: req.admin!.nameLabel,
      });
      res.status(201).json({ puzzle, validation });
    } catch (err) {
      if (err instanceof UnwordleServiceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

unwordleAdminRouter.post(
  "/:eventId/unwordle/puzzle/validate",
  asyncHandler(async (req, res) => {
    const parsed = createPuzzleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "solutionWord (5 letters) and 4 row patterns of 5 tiles each are required" });
      return;
    }
    res.status(200).json(await checkPuzzlePatterns(parsed.data.solutionWord, parsed.data.rowPatterns));
  })
);

const statusSchema = z.object({ status: z.enum(["DRAFT", "PUBLISHED"]) });

unwordleAdminRouter.post(
  "/:eventId/unwordle/puzzle/status",
  asyncHandler(async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "status must be DRAFT or PUBLISHED" });
      return;
    }
    const eventId = Number(req.params.eventId);
    const puzzle = await findPuzzleByEventId(eventId);
    if (!puzzle) {
      res.status(404).json({ error: "No UNWORDLE puzzle exists for this event yet" });
      return;
    }
    await adminSetPuzzleStatus(puzzle.id, eventId, parsed.data.status, req.admin!.nameLabel);
    res.status(200).json({ ok: true });
  })
);

unwordleAdminRouter.get(
  "/:eventId/unwordle/sessions",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getSessionMonitor(Number(req.params.eventId)));
  })
);

unwordleAdminRouter.get(
  "/:eventId/unwordle/puzzle",
  asyncHandler(async (req, res) => {
    const puzzle = await findPuzzleByEventId(Number(req.params.eventId));
    if (!puzzle) {
      res.status(404).json({ error: "No UNWORDLE puzzle exists for this event yet" });
      return;
    }
    res.status(200).json(puzzle);
  })
);

const advanceSchema = z.object({ eventPlayerIds: z.array(z.number().int().positive()).min(1) });

unwordleAdminRouter.post(
  "/:eventId/unwordle/sessions",
  asyncHandler(async (req, res) => {
    const parsed = advanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "eventPlayerIds array is required" });
      return;
    }
    const puzzle = await findPuzzleByEventId(Number(req.params.eventId));
    if (!puzzle) {
      res.status(404).json({ error: "No UNWORDLE puzzle exists for this event yet" });
      return;
    }
    const sessions = [];
    for (const eventPlayerId of parsed.data.eventPlayerIds) {
      sessions.push(await ensurePlayerSession(puzzle.id, eventPlayerId));
    }
    res.status(200).json({ sessions });
  })
);

unwordleAdminRouter.get(
  "/:eventId/unwordle/leaderboard",
  asyncHandler(async (req, res) => {
    const puzzle = await findPuzzleByEventId(Number(req.params.eventId));
    if (!puzzle) {
      res.status(404).json({ error: "No UNWORDLE puzzle exists for this event yet" });
      return;
    }
    res.status(200).json(await getLeaderboard(puzzle.id));
  })
);

export const unwordlePlayerRouter = Router();
unwordlePlayerRouter.use(asyncHandler(requirePlayerAuth));

unwordlePlayerRouter.get(
  "/:eventId/unwordle/status",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getPlayerRoundStatus(Number(req.params.eventId), req.player!.eventPlayerId));
  })
);

unwordlePlayerRouter.get(
  "/:eventId/unwordle/leaderboard",
  asyncHandler(async (req, res) => {
    const puzzle = await findPuzzleByEventId(Number(req.params.eventId));
    if (!puzzle) {
      res.status(404).json({ error: "No UNWORDLE puzzle exists for this event yet" });
      return;
    }
    res.status(200).json(await getLeaderboard(puzzle.id));
  })
);
