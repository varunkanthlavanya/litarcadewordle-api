import type { TimedWordleScheduler } from "../modules/timed-wordle/engine/timerScheduler.js";
import { recoverInProgressSessions } from "../modules/timed-wordle/tw.service.js";

/** Reloads every IN_PROGRESS Timed Wordle session from Postgres into the in-process
 * scheduler on boot, so a process restart/redeploy mid-event doesn't lose live timers. */
export async function bootTimedWordleScheduler(scheduler: TimedWordleScheduler): Promise<void> {
  const recovered = await recoverInProgressSessions(scheduler);
  if (recovered > 0) {
    console.log(`Recovered ${recovered} in-progress Timed Wordle session(s) from Postgres`);
  }
  scheduler.start();
}
