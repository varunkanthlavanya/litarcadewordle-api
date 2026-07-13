import type { Namespace, Socket } from "socket.io";
import type { TimedWordleStateDto } from "@litarcadewordle/shared-types";
import type { TimedWordleScheduler } from "./engine/timerScheduler.js";
import {
  adminAdjustClock,
  adminBulkEndSessions,
  adminEndOneSession,
  playerStartOrResumeSession,
  submitGuess,
  TimedWordleServiceError,
} from "./tw.service.js";

function serializeState(state: Awaited<ReturnType<typeof playerStartOrResumeSession>>["state"]): TimedWordleStateDto {
  return {
    status: state.status,
    currentTryNumber: state.currentTryNumber,
    currentTryDeadlineAt: state.currentTryDeadlineAt,
    graceActive: state.graceActive,
    graceDeadlineAt: state.graceDeadlineAt,
    globalDeadlineAt: state.globalDeadlineAt,
    bankedSurplusMs: state.bankedSurplusMs,
    tries: state.tries,
    found: state.found,
    cumulativeTimeMs: state.cumulativeTimeMs,
    triesUsed: state.triesUsed,
    tileScore: state.tileScore,
  };
}

export function registerTimedWordleSockets(
  playerNsp: Namespace,
  adminNsp: Namespace,
  scheduler: TimedWordleScheduler
): void {
  playerNsp.on("connection", (socket: Socket) => {
    socket.on(
      "tw:game:start",
      async ({ eventId }: { eventId: number }, ack?: (res: unknown) => void) => {
        try {
          const player = socket.data.player;
          if (!player) throw new TimedWordleServiceError("Not authenticated");

          const { state, sessionId } = await playerStartOrResumeSession({
            eventId,
            eventPlayerId: player.eventPlayerId,
            scheduler,
            now: Date.now(),
          });

          socket.join(`session:${sessionId}`);
          ack?.({ ok: true, sessionId, state: serializeState(state) });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to start session" });
        }
      }
    );

    socket.on(
      "tw:guess:submit",
      async (
        { sessionId, guess }: { sessionId: number; guess: string },
        ack?: (res: unknown) => void
      ) => {
        try {
          const { feedback, state } = await submitGuess(scheduler, sessionId, guess, Date.now());
          ack?.({ ok: true, feedback, state: serializeState(state) });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Guess submission failed" });
        }
      }
    );
  });

  adminNsp.on("connection", (socket: Socket) => {
    socket.on(
      "admin:tw:session:end",
      async ({ sessionId, reason }: { sessionId: number; reason?: string }, ack?: (res: unknown) => void) => {
        try {
          const adminLabel = socket.data.admin?.nameLabel ?? "unknown";
          await adminEndOneSession(scheduler, sessionId, adminLabel, reason);
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to end session" });
        }
      }
    );

    socket.on(
      "admin:tw:session:bulkEnd",
      async ({ sessionIds, reason }: { sessionIds: number[]; reason?: string }, ack?: (res: unknown) => void) => {
        const adminLabel = socket.data.admin?.nameLabel ?? "unknown";
        const result = await adminBulkEndSessions(scheduler, sessionIds, adminLabel, reason);
        ack?.({ ok: true, ...result });
      }
    );

    socket.on(
      "admin:tw:clock:adjust",
      async (
        params: { sessionId: number; deltaSeconds: number; scope: "GLOBAL" | "CURRENT_TRY"; reason?: string },
        ack?: (res: unknown) => void
      ) => {
        try {
          const adminLabel = socket.data.admin?.nameLabel ?? "unknown";
          const state = await adminAdjustClock({ scheduler, adminLabel, ...params });
          ack?.({ ok: true, state: serializeState(state) });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to adjust clock" });
        }
      }
    );
  });
}
