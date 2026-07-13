import { describe, expect, it } from "vitest";
import type { TileColor } from "@litarcadewordle/shared-types";
import {
  adminEndSession,
  adminStartSession,
  createSession,
  InvalidUnwordleTransitionError,
  playerExitSession,
  submitWord,
} from "./stateMachine.js";
import { compareUnwordleSessions, isRankable } from "./scoring.js";

const T0 = 1_700_000_000_000;
const SOLUTION = "APPLE";
const ALL_GREEN: TileColor[] = ["GREEN", "GREEN", "GREEN", "GREEN", "GREEN"];
const alwaysWord = () => true;

function fourRowSession() {
  return createSession(SOLUTION, [ALL_GREEN, ALL_GREEN, ALL_GREEN, ALL_GREEN]);
}

describe("session lifecycle", () => {
  it("#7 blocks guesses before the admin starts the session", () => {
    const session = fourRowSession();
    expect(() => submitWord(session, 0, "APPLE", T0, alwaysWord)).toThrow(InvalidUnwordleTransitionError);
  });

  it("starts the stopwatch only when the admin explicitly starts the session", () => {
    const session = adminStartSession(fourRowSession(), T0);
    expect(session.status).toBe("IN_PROGRESS");
    expect(session.startTime).toBe(T0);
  });
});

describe("submitWord", () => {
  it("#1 rejects a non-dictionary word as an invalid submission, row stays unsolved", () => {
    let session = adminStartSession(fourRowSession(), T0);
    const isWord = () => false;
    const { session: after, outcome } = submitWord(session, 0, "ZZZZZ", T0 + 1000, isWord);
    expect(outcome.kind).toBe("REJECTED_INVALID_WORD");
    expect(after.rows[0].invalidSubmissions).toBe(1);
    expect(after.rows[0].attempts).toBe(0);
    expect(after.rows[0].solved).toBe(false);
  });

  it("#2 counts a constraint-violating real word as a valid attempt", () => {
    let session = adminStartSession(fourRowSession(), T0);
    const { session: after, outcome } = submitWord(session, 0, "GRAPE", T0 + 1000, alwaysWord);
    expect(outcome.kind).toBe("REJECTED_TILE_MISMATCH");
    expect(after.rows[0].attempts).toBe(1);
    expect(after.rows[0].invalidSubmissions).toBe(0);
    expect(after.rows[0].solved).toBe(false);
  });

  it("#3 solves the row on a fully constraint-satisfying guess and moves toward completion", () => {
    let session = adminStartSession(fourRowSession(), T0);
    const { session: after, outcome } = submitWord(session, 0, "APPLE", T0 + 1000, alwaysWord);
    expect(outcome.kind).toBe("ACCEPTED");
    expect(after.rows[0].solved).toBe(true);
    expect(after.rows[0].solvedWord).toBe("APPLE");
    expect(after.status).toBe("IN_PROGRESS"); // only 1 of 4 rows solved
  });

  it("auto-completes the session the instant the 4th row is solved (stopwatch auto-stops)", () => {
    let session = adminStartSession(fourRowSession(), T0);
    for (let i = 0; i < 3; i++) {
      session = submitWord(session, i, "APPLE", T0 + 1000, alwaysWord).session;
    }
    expect(session.status).toBe("IN_PROGRESS");

    const { session: after, outcome } = submitWord(session, 3, "APPLE", T0 + 5000, alwaysWord);
    expect(outcome.kind).toBe("ACCEPTED");
    if (outcome.kind === "ACCEPTED") expect(outcome.puzzleCompleted).toBe(true);
    expect(after.status).toBe("COMPLETED");
    expect(after.stopTime).toBe(T0 + 5000);
    expect(after.rowsSolvedCount).toBe(4);
    expect(after.totalTimeMs).toBe(5000);
  });

  it("rejects submitting to an already-solved row", () => {
    let session = adminStartSession(fourRowSession(), T0);
    session = submitWord(session, 0, "APPLE", T0 + 1000, alwaysWord).session;
    expect(() => submitWord(session, 0, "APPLE", T0 + 2000, alwaysWord)).toThrow(InvalidUnwordleTransitionError);
  });
});

describe("admin end session (PRD §8 acceptance #8)", () => {
  it("stops the stopwatch immediately and snapshots metrics with partial progress", () => {
    let session = adminStartSession(fourRowSession(), T0);
    session = submitWord(session, 0, "APPLE", T0 + 1000, alwaysWord).session;
    session = submitWord(session, 1, "APPLE", T0 + 2000, alwaysWord).session;

    const ended = adminEndSession(session, T0 + 10_000);
    expect(ended.status).toBe("ENDED");
    expect(ended.rowsSolvedCount).toBe(2);
    expect(ended.totalTimeMs).toBe(10_000);
    expect(isRankable(ended.status)).toBe(true);
  });

  it("only allows ending an IN_PROGRESS session", () => {
    const session = fourRowSession(); // NOT_STARTED
    expect(() => adminEndSession(session, T0)).toThrow(InvalidUnwordleTransitionError);
  });
});

describe("player exit (PRD §2.5/§4.1 — sole leaderboard exclusion)", () => {
  it("#10 marks the session EXITED and excluded from the leaderboard", () => {
    let session = adminStartSession(fourRowSession(), T0);
    const exited = playerExitSession(session, T0 + 3000);
    expect(exited.status).toBe("EXITED");
    expect(exited.excludedFromLeaderboard).toBe(true);
    expect(isRankable(exited.status)).toBe(false);
  });
});

describe("compareUnwordleSessions — ranking waterfall (PRD §4.2/§9 acceptance #9, #5, #11)", () => {
  it("#9 ranks 4/4 completion above a 2/4 admin-ended session regardless of time", () => {
    const playerA = { id: 1, rowsSolvedCount: 4, totalTimeMs: 190_000, totalAttempts: 8, totalInvalidSubmissions: 0 };
    const playerB = { id: 2, rowsSolvedCount: 2, totalTimeMs: 60_000, totalAttempts: 3, totalInvalidSubmissions: 0 };
    expect(compareUnwordleSessions(playerA, playerB)).toBeLessThan(0);
  });

  it("#5/#11 breaks a same-rows-same-time tie by fewer attempts, then fewer invalid submissions, then id", () => {
    const a = { id: 2, rowsSolvedCount: 4, totalTimeMs: 100_000, totalAttempts: 5, totalInvalidSubmissions: 1 };
    const b = { id: 1, rowsSolvedCount: 4, totalTimeMs: 100_000, totalAttempts: 4, totalInvalidSubmissions: 2 };
    expect(compareUnwordleSessions(a, b)).toBeGreaterThan(0); // b wins on fewer attempts

    const c = { id: 3, rowsSolvedCount: 4, totalTimeMs: 100_000, totalAttempts: 4, totalInvalidSubmissions: 2 };
    const d = { id: 2, rowsSolvedCount: 4, totalTimeMs: 100_000, totalAttempts: 4, totalInvalidSubmissions: 1 };
    expect(compareUnwordleSessions(c, d)).toBeGreaterThan(0); // d wins on fewer invalid submissions

    const e = { id: 5, rowsSolvedCount: 4, totalTimeMs: 100_000, totalAttempts: 4, totalInvalidSubmissions: 1 };
    const f = { id: 3, rowsSolvedCount: 4, totalTimeMs: 100_000, totalAttempts: 4, totalInvalidSubmissions: 1 };
    expect(compareUnwordleSessions(e, f)).toBeGreaterThan(0); // f wins on lower id (final fallback)
  });
});
