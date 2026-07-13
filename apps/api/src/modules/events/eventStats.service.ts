import { listOnlinePlayerIds } from "../../websocket/presence.js";
import { listEventPlayers } from "./eventPlayers.repo.js";
import { findEventById } from "./events.repo.js";
import { findPuzzleByEventId as findTwPuzzleByEventId } from "../timed-wordle/tw.repo.js";
import { findPuzzleByEventId as findUwPuzzleByEventId, listSessionsForPuzzle as listUwSessionsForPuzzle } from "../unwordle/uw.repo.js";
import { pool } from "../../db/pool.js";

const TW_TERMINAL = new Set(["FOUND", "NOT_FOUND_TRIES", "NOT_FOUND_TIME", "ADMIN_ENDED"]);
const UW_TERMINAL = new Set(["COMPLETED", "ENDED"]);

export interface EventStats {
  cohortSize: number;
  onlineNow: number;
  completedCount: number;
}

export async function getEventStats(eventId: number): Promise<EventStats> {
  const event = await findEventById(eventId);
  const cohort = await listEventPlayers(eventId);
  const cohortIds = new Set(cohort.map((p) => p.id));

  const online = listOnlinePlayerIds().filter((id) => cohortIds.has(id)).length;

  let completedCount = 0;
  const inPlayoffsStage = event?.status === "PLAYOFFS_SCHEDULED" || event?.status === "PLAYOFFS_LIVE" || event?.status === "PLAYOFFS_CLOSED";

  if (inPlayoffsStage) {
    const puzzle = await findUwPuzzleByEventId(eventId);
    if (puzzle) {
      const sessions = await listUwSessionsForPuzzle(puzzle.id);
      completedCount = sessions.filter((s) => UW_TERMINAL.has(s.status)).length;
    }
  } else {
    const puzzle = await findTwPuzzleByEventId(eventId);
    if (puzzle) {
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM timed_wordle_sessions WHERE puzzle_id = $1 AND status = ANY($2)`,
        [puzzle.id, [...TW_TERMINAL]]
      );
      completedCount = Number(result.rows[0]?.count ?? 0);
    }
  }

  return { cohortSize: cohortIds.size, onlineNow: online, completedCount };
}
