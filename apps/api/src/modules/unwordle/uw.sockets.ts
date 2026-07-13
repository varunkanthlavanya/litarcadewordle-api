import type { Namespace, Socket } from "socket.io";
import { findPuzzleByEventId } from "./uw.repo.js";
import { adminEndAllInProgress, adminEndOne, adminStart, getPlayerRoundStatus, playerExit, submitPlayerGuess, type UnwordleIo } from "./uw.service.js";

export function registerUnwordleSockets(playerNsp: Namespace, adminNsp: Namespace, io: UnwordleIo): void {
  playerNsp.on("connection", (socket: Socket) => {
    socket.on(
      "uw:game:join",
      async ({ eventId }: { eventId: number }, ack?: (res: unknown) => void) => {
        try {
          const player = socket.data.player;
          if (!player) throw new Error("Not authenticated");
          const status = await getPlayerRoundStatus(eventId, player.eventPlayerId);
          if (status.sessionId !== null) {
            socket.join(`session:${status.sessionId}`);
          }
          ack?.({ ok: true, status });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to load round status" });
        }
      }
    );

    socket.on(
      "uw:row:submit",
      async (
        { eventId, sessionId, rowIndex, guess }: { eventId: number; sessionId: number; rowIndex: number; guess: string },
        ack?: (res: unknown) => void
      ) => {
        try {
          const puzzle = await findPuzzleByEventId(eventId);
          if (!puzzle) throw new Error("Puzzle not found");
          const { outcome } = await submitPlayerGuess({
            sessionId,
            eventId,
            puzzleId: puzzle.id,
            solutionWord: puzzle.solution_word,
            rowPatterns: puzzle.row_patterns,
            rowIndex,
            guess,
            io,
          });
          ack?.({ ok: true, outcome });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to submit guess" });
        }
      }
    );

    socket.on(
      "uw:exit",
      async ({ eventId, sessionId }: { eventId: number; sessionId: number }, ack?: (res: unknown) => void) => {
        try {
          const puzzle = await findPuzzleByEventId(eventId);
          if (!puzzle) throw new Error("Puzzle not found");
          await playerExit({ sessionId, solutionWord: puzzle.solution_word, rowPatterns: puzzle.row_patterns });
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to exit" });
        }
      }
    );
  });

  adminNsp.on("connection", (socket: Socket) => {
    socket.on(
      "admin:uw:session:start",
      async ({ eventId, sessionId }: { eventId: number; sessionId: number }, ack?: (res: unknown) => void) => {
        try {
          const adminLabel = socket.data.admin?.nameLabel ?? "unknown";
          await adminStart({ sessionId, eventId, io, adminLabel });
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to start session" });
        }
      }
    );

    socket.on(
      "admin:uw:session:end",
      async (
        { eventId, sessionId, reason }: { eventId: number; sessionId: number; reason?: string },
        ack?: (res: unknown) => void
      ) => {
        try {
          const puzzle = await findPuzzleByEventId(eventId);
          if (!puzzle) throw new Error("Puzzle not found");
          const adminLabel = socket.data.admin?.nameLabel ?? "unknown";
          await adminEndOne({
            sessionId,
            eventId,
            solutionWord: puzzle.solution_word,
            rowPatterns: puzzle.row_patterns,
            io,
            adminLabel,
            reason,
          });
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to end session" });
        }
      }
    );

    socket.on(
      "admin:uw:session:endAll",
      async ({ eventId }: { eventId: number }, ack?: (res: unknown) => void) => {
        try {
          const puzzle = await findPuzzleByEventId(eventId);
          if (!puzzle) throw new Error("Puzzle not found");
          const adminLabel = socket.data.admin?.nameLabel ?? "unknown";
          const count = await adminEndAllInProgress({
            eventId,
            puzzleId: puzzle.id,
            solutionWord: puzzle.solution_word,
            rowPatterns: puzzle.row_patterns,
            io,
            adminLabel,
          });
          ack?.({ ok: true, count });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Failed to end all sessions" });
        }
      }
    );
  });
}
