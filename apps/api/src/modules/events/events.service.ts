import { config } from "../../config/index.js";
import { writeAuditEntry } from "../audit/audit.service.js";
import {
  bulkInsertPlayers,
  countEventPlayers,
  listEventPlayers,
  type EventPlayerRow,
} from "./eventPlayers.repo.js";
import type { EventStatus } from "@litarcadewordle/shared-types";
import {
  findEventById,
  insertEvent,
  listEvents,
  listEventsWithCohortSize,
  updateEventConfig,
  updateEventStatus,
  type EventRow,
  type EventWithCohortSize,
} from "./events.repo.js";

export async function createEvent(params: { name: string; adminLabel: string }): Promise<EventRow> {
  const event = await insertEvent({ name: params.name, timezone: config.eventTimezone });
  await writeAuditEntry({
    adminLabel: params.adminLabel,
    eventId: event.id,
    actionType: "EVENT_CREATED",
    targetType: "event",
    targetIds: [event.id],
  });
  return event;
}

export async function getEvent(id: number): Promise<EventRow | null> {
  return findEventById(id);
}

export async function getAllEvents(): Promise<EventRow[]> {
  return listEvents();
}

export async function getAllEventsWithCohortSize(): Promise<EventWithCohortSize[]> {
  return listEventsWithCohortSize();
}

export class DuplicateMobileNumbersError extends Error {
  constructor(public readonly duplicates: string[]) {
    super(`Cohort upload contains duplicate mobile numbers: ${duplicates.join(", ")}`);
    this.name = "DuplicateMobileNumbersError";
  }
}

export async function uploadCohort(params: {
  eventId: number;
  players: Array<{ mobileNumber: string; displayName?: string }>;
  adminLabel: string;
}): Promise<EventPlayerRow[]> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const p of params.players) {
    const key = p.mobileNumber.trim();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size > 0) {
    throw new DuplicateMobileNumbersError([...duplicates]);
  }

  const inserted = await bulkInsertPlayers(params.eventId, params.players);
  await updateEventStatus(params.eventId, "COHORT_UPLOADED");
  await writeAuditEntry({
    adminLabel: params.adminLabel,
    eventId: params.eventId,
    actionType: "COHORT_UPLOADED",
    targetType: "event_player",
    metadata: { count: inserted.length },
  });
  return inserted;
}

export async function getCohort(eventId: number): Promise<EventPlayerRow[]> {
  return listEventPlayers(eventId);
}

export async function getCohortSize(eventId: number): Promise<number> {
  return countEventPlayers(eventId);
}

export async function adminSetEventStatus(eventId: number, status: EventStatus, adminLabel: string): Promise<EventRow | null> {
  const event = await updateEventStatus(eventId, status);
  await writeAuditEntry({
    adminLabel,
    eventId,
    actionType: "EVENT_STATUS_CHANGED",
    targetType: "event",
    targetIds: [eventId],
    metadata: { status },
  });
  return event;
}

export async function adminUpdateEventConfig(
  eventId: number,
  params: { roundOpensAt?: string; roundClosesAt?: string; prelimsTopN?: number; playoffsWinnerCount?: number },
  adminLabel: string
): Promise<EventRow | null> {
  const event = await updateEventConfig(eventId, {
    roundOpensAt: params.roundOpensAt ? new Date(params.roundOpensAt) : undefined,
    roundClosesAt: params.roundClosesAt ? new Date(params.roundClosesAt) : undefined,
    prelimsTopN: params.prelimsTopN,
    playoffsWinnerCount: params.playoffsWinnerCount,
  });
  await writeAuditEntry({
    adminLabel,
    eventId,
    actionType: "EVENT_CONFIG_UPDATED",
    targetType: "event",
    targetIds: [eventId],
    metadata: params,
  });
  return event;
}
