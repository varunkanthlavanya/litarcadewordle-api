import { writeAuditEntry } from "../audit/audit.service.js";
import { updateEventStatus } from "../events/events.repo.js";
import { getLeaderboard as getTwLeaderboard } from "../timed-wordle/tw.service.js";
import { findPuzzleByEventId as findTwPuzzleByEventId, markSessionsAdvancedToPlayoffs } from "../timed-wordle/tw.repo.js";
import { findPuzzleByEventId as findUwPuzzleByEventId } from "../unwordle/uw.repo.js";
import { ensurePlayerSession } from "../unwordle/uw.service.js";
import type { NotificationsService } from "../notifications/notifications.service.js";

export class CutoffServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CutoffServiceError";
  }
}

export interface CutoffPreviewRow {
  sessionId: number;
  eventPlayerId: number;
  rank: number;
  found: boolean;
  cumulativeTimeMs: number;
  triesUsed: number;
  tileScore: number;
  withinCutoff: boolean;
}

export async function getCutoffPreview(eventId: number, topN: number): Promise<CutoffPreviewRow[]> {
  const puzzle = await findTwPuzzleByEventId(eventId);
  if (!puzzle) throw new CutoffServiceError("No Timed Wordle puzzle exists for this event yet");

  const leaderboard = await getTwLeaderboard(puzzle.id);
  return leaderboard.map((entry) => ({ ...entry, withinCutoff: entry.rank <= topN }));
}

export async function confirmCutoff(params: {
  eventId: number;
  eventPlayerIds: number[];
  adminLabel: string;
  notifications: NotificationsService;
}): Promise<{ advancedCount: number }> {
  const twPuzzle = await findTwPuzzleByEventId(params.eventId);
  if (!twPuzzle) throw new CutoffServiceError("No Timed Wordle puzzle exists for this event yet");

  const uwPuzzle = await findUwPuzzleByEventId(params.eventId);
  if (!uwPuzzle) {
    throw new CutoffServiceError("Create the UNWORDLE puzzle before advancing players to Playoffs");
  }

  const leaderboard = await getTwLeaderboard(twPuzzle.id);
  const advancing = leaderboard.filter((e) => params.eventPlayerIds.includes(e.eventPlayerId));

  for (const entry of advancing) {
    await ensurePlayerSession(uwPuzzle.id, entry.eventPlayerId);
  }
  await markSessionsAdvancedToPlayoffs(advancing.map((e) => e.sessionId));

  for (const entry of advancing) {
    await params.notifications.sendToOne({
      eventId: params.eventId,
      eventPlayerId: entry.eventPlayerId,
      type: "ADVANCED",
      title: "You've advanced to the Playoffs!",
      body: `Ranked #${entry.rank} in Prelims — head to the Playoffs lobby when you're ready.`,
      adminLabel: params.adminLabel,
    });
  }

  await updateEventStatus(params.eventId, "PLAYOFFS_SCHEDULED");

  await writeAuditEntry({
    adminLabel: params.adminLabel,
    eventId: params.eventId,
    actionType: "ADVANCED_TO_PLAYOFFS",
    targetType: "event_player",
    targetIds: params.eventPlayerIds,
    metadata: { advancedCount: advancing.length },
  });

  return { advancedCount: advancing.length };
}
