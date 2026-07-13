import { Router } from "express";
import { z } from "zod";
import { requireAdminAuth } from "../../middleware/requireAdminAuth.js";
import { asyncHandler } from "../../shared/asyncHandler.js";
import {
  adminSetEventStatus,
  adminUpdateEventConfig,
  createEvent,
  DuplicateMobileNumbersError,
  getAllEventsWithCohortSize,
  getCohort,
  getEvent,
  uploadCohort,
} from "./events.service.js";
import { CohortTooLargeError } from "./eventPlayers.repo.js";
import { getEventStats } from "./eventStats.service.js";

export const eventsRouter = Router();

eventsRouter.use(asyncHandler(requireAdminAuth));

const createEventSchema = z.object({ name: z.string().min(1).max(200) });

eventsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const event = await createEvent({ name: parsed.data.name, adminLabel: req.admin!.nameLabel });
    res.status(201).json(event);
  })
);

eventsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getAllEventsWithCohortSize());
  })
);

eventsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const event = await getEvent(Number(req.params.id));
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.status(200).json(event);
  })
);

const cohortUploadSchema = z.object({
  players: z
    .array(
      z.object({
        mobileNumber: z.string().min(6).max(20),
        displayName: z.string().max(120).optional(),
      })
    )
    .min(1)
    .max(600),
});

eventsRouter.post(
  "/:id/cohort",
  asyncHandler(async (req, res) => {
    const parsed = cohortUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "players array is required (max 600, each with mobileNumber)" });
      return;
    }

    try {
      const inserted = await uploadCohort({
        eventId: Number(req.params.id),
        players: parsed.data.players,
        adminLabel: req.admin!.nameLabel,
      });
      res.status(200).json({ count: inserted.length });
    } catch (err) {
      if (err instanceof CohortTooLargeError || err instanceof DuplicateMobileNumbersError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

eventsRouter.get(
  "/:id/cohort",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getCohort(Number(req.params.id)));
  })
);

eventsRouter.get(
  "/:id/stats",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getEventStats(Number(req.params.id)));
  })
);

const statusSchema = z.object({
  status: z.enum([
    "DRAFT",
    "COHORT_UPLOADED",
    "PRELIMS_SCHEDULED",
    "PRELIMS_LIVE",
    "PRELIMS_CLOSED",
    "PLAYOFFS_SCHEDULED",
    "PLAYOFFS_LIVE",
    "PLAYOFFS_CLOSED",
    "ARCHIVED",
  ]),
});

eventsRouter.post(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A valid status is required" });
      return;
    }
    const event = await adminSetEventStatus(Number(req.params.id), parsed.data.status, req.admin!.nameLabel);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.status(200).json(event);
  })
);

const configSchema = z.object({
  roundOpensAt: z.string().datetime().optional(),
  roundClosesAt: z.string().datetime().optional(),
  prelimsTopN: z.number().int().min(5).max(50).optional(),
  playoffsWinnerCount: z.number().int().min(3).max(5).optional(),
});

eventsRouter.post(
  "/:id/config",
  asyncHandler(async (req, res) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid config payload" });
      return;
    }
    const event = await adminUpdateEventConfig(Number(req.params.id), parsed.data, req.admin!.nameLabel);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.status(200).json(event);
  })
);
