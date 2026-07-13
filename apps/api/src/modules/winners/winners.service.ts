import { writeAuditEntry } from "../audit/audit.service.js";
import { listWinners, replaceWinners, type EventWinnerRow } from "./winners.repo.js";

export async function saveWinners(
  eventId: number,
  winners: Array<{ eventPlayerId: number; place: number }>,
  adminLabel: string
): Promise<EventWinnerRow[]> {
  const rows = await replaceWinners(eventId, winners);
  await writeAuditEntry({
    adminLabel,
    eventId,
    actionType: "WINNERS_SAVED",
    targetType: "event_player",
    targetIds: winners.map((w) => w.eventPlayerId),
    metadata: { winners },
  });
  return rows;
}

export async function getWinners(eventId: number): Promise<EventWinnerRow[]> {
  return listWinners(eventId);
}
