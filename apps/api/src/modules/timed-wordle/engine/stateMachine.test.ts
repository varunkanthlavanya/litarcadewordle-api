import { describe, expect, it } from "vitest";
import {
  adjustCurrentTryDeadline,
  adjustGlobalDeadline,
  adminEndSession,
  applyGuess,
  forceEndOnGlobalTimeout,
  openGrace,
  skipCurrentTry,
  startSession,
} from "./stateMachine.js";
import { GRACE_DOCK_MS, GRACE_MS, TRY_BUDGET_MS } from "./constants.js";

const SECRET = "CRANE";
const T0 = 1_700_000_000_000;

describe("startSession", () => {
  it("starts try 1 with the full 60s budget and no dock/bank", () => {
    const session = startSession(SECRET, T0);
    expect(session.currentTryNumber).toBe(1);
    expect(session.currentTryBudgetMs).toBe(TRY_BUDGET_MS);
    expect(session.currentTryDeadlineAt).toBe(T0 + TRY_BUDGET_MS);
    expect(session.globalDeadlineAt).toBe(T0 + 360_000);
    expect(session.bankedSurplusMs).toBe(0);
  });
});

describe("applyGuess — win condition", () => {
  it("marks FOUND on an all-green guess and stops the game immediately", () => {
    let session = startSession(SECRET, T0);
    const { session: after, feedback } = applyGuess(session, "CRANE", T0 + 10_000);
    expect(feedback).toEqual(["GREEN", "GREEN", "GREEN", "GREEN", "GREEN"]);
    expect(after.status).toBe("FOUND");
    expect(after.found).toBe(true);
    expect(after.cumulativeTimeMs).toBe(10_000);
    expect(after.triesUsed).toBe(1);
  });
});

describe("applyGuess — time banking (PRD §3.3)", () => {
  it("banks unused time from an early submit but does not apply it to try 2", () => {
    let session = startSession(SECRET, T0);
    const { session: afterTry1 } = applyGuess(session, "STORY", T0 + 20_000); // 40s surplus
    expect(afterTry1.bankedSurplusMs).toBe(40_000);
    expect(afterTry1.currentTryNumber).toBe(2);
    expect(afterTry1.currentTryBudgetMs).toBe(TRY_BUDGET_MS); // try 2 untouched by bank
  });

  it("accumulates surplus across tries 1-5 and applies the full bank only to try 6", () => {
    let session = startSession(SECRET, T0);
    let now = T0;

    // Tries 1-5: submit a non-matching word instantly (0s used -> full 60s surplus each)
    for (let tryN = 1; tryN <= 5; tryN++) {
      const result = applyGuess(session, "STORY", now);
      session = result.session;
      now = session.currentTryStartedAt; // move clock to the new try's start
    }

    expect(session.currentTryNumber).toBe(6);
    expect(session.bankedSurplusMs).toBe(5 * TRY_BUDGET_MS);
    expect(session.currentTryBudgetMs).toBe(TRY_BUDGET_MS + 5 * TRY_BUDGET_MS);
  });
});

describe("applyGuess — grace period penalty (PRD §3.2)", () => {
  it("triggers grace and docks try 2's budget when try 1 is submitted after 60s but within grace", () => {
    let session = startSession(SECRET, T0);
    const submitAt = T0 + TRY_BUDGET_MS + 15_000; // 75s used, within the 90s ceiling
    const { session: after } = applyGuess(session, "STORY", submitAt);

    expect(after.tries[0].usedGrace).toBe(true);
    expect(after.tries[0].timeUsedMs).toBe(75_000);
    expect(after.bankedSurplusMs).toBe(0); // no surplus when grace was used
    expect(after.currentTryNumber).toBe(2);
    expect(after.currentTryBudgetMs).toBe(TRY_BUDGET_MS - GRACE_DOCK_MS);
  });

  it("docks the next try unconditionally even if the guess is submitted immediately after crossing 60s", () => {
    let session = startSession(SECRET, T0);
    const submitAt = T0 + TRY_BUDGET_MS + 1; // barely crossed into grace
    const { session: after } = applyGuess(session, "STORY", submitAt);
    expect(after.tries[0].usedGrace).toBe(true);
    expect(after.currentTryBudgetMs).toBe(TRY_BUDGET_MS - GRACE_DOCK_MS);
  });

  it("rejects a guess submitted after the full 90s grace ceiling has elapsed", () => {
    const session = startSession(SECRET, T0);
    const tooLate = T0 + TRY_BUDGET_MS + GRACE_MS + 1;
    expect(() => applyGuess(session, "STORY", tooLate)).toThrow();
  });
});

describe("skipCurrentTry (PRD §3.2)", () => {
  it("marks the try SKIPPED and docks the next try when the full grace ceiling elapses unsubmitted", () => {
    const session = startSession(SECRET, T0);
    const skipAt = T0 + TRY_BUDGET_MS + GRACE_MS;
    const after = skipCurrentTry(session, skipAt);

    expect(after.tries).toHaveLength(1);
    expect(after.tries[0].status).toBe("SKIPPED");
    expect(after.tries[0].guess).toBeNull();
    expect(after.currentTryNumber).toBe(2);
    expect(after.currentTryBudgetMs).toBe(TRY_BUDGET_MS - GRACE_DOCK_MS);
  });

  it("finalizes as NOT_FOUND_TRIES if try 6 itself is skipped", () => {
    let session = startSession(SECRET, T0);
    let now = T0;
    for (let tryN = 1; tryN <= 5; tryN++) {
      session = skipCurrentTry(session, now + TRY_BUDGET_MS + GRACE_MS);
      now = session.currentTryStartedAt;
    }
    expect(session.currentTryNumber).toBe(6);

    const finalSession = skipCurrentTry(session, session.currentTryStartedAt + session.currentTryBudgetMs + GRACE_MS);
    expect(finalSession.status).toBe("NOT_FOUND_TRIES");
    expect(finalSession.found).toBe(false);
    expect(finalSession.cumulativeTimeMs).toBe(360_000);
    expect(finalSession.triesUsed).toBe(6);
  });
});

describe("openGrace", () => {
  it("flags grace as active once the try budget elapses, without altering scoring state", () => {
    const session = startSession(SECRET, T0);
    const after = openGrace(session, T0 + TRY_BUDGET_MS);
    expect(after.graceActive).toBe(true);
    expect(after.graceDeadlineAt).toBe(T0 + TRY_BUDGET_MS + GRACE_MS);
  });

  it("is a no-op before the try budget has elapsed", () => {
    const session = startSession(SECRET, T0);
    const after = openGrace(session, T0 + 10_000);
    expect(after.graceActive).toBe(false);
  });
});

describe("forceEndOnGlobalTimeout (PRD §3.5)", () => {
  it("force-ends the game the instant the global 360s clock expires, mid-try", () => {
    const session = startSession(SECRET, T0);
    const after = forceEndOnGlobalTimeout(session, T0 + 360_000);
    expect(after.status).toBe("NOT_FOUND_TIME");
    expect(after.found).toBe(false);
    expect(after.cumulativeTimeMs).toBe(360_000);
    expect(after.tries).toHaveLength(1);
    expect(after.tries[0].status).toBe("SKIPPED");
  });

  it("is a no-op before the global deadline", () => {
    const session = startSession(SECRET, T0);
    const after = forceEndOnGlobalTimeout(session, T0 + 100_000);
    expect(after.status).toBe("IN_PROGRESS");
  });
});

describe("adminEndSession (PRD §5.4)", () => {
  it("ends the session as ADMIN_ENDED, scored as a normal loss with accumulated progress", () => {
    let session = startSession(SECRET, T0);
    const { session: afterTry1 } = applyGuess(session, "STORY", T0 + 20_000);
    const ended = adminEndSession(afterTry1, afterTry1.currentTryStartedAt + 5_000);

    expect(ended.status).toBe("ADMIN_ENDED");
    expect(ended.found).toBe(false);
    expect(ended.cumulativeTimeMs).toBe(360_000); // non-finishers always score the full clock
    expect(ended.triesUsed).toBe(2); // try 1 submitted + try 2 recorded as skipped/interrupted
  });

  it("is a no-op if the session already ended", () => {
    let session = startSession(SECRET, T0);
    const { session: found } = applyGuess(session, "CRANE", T0 + 5_000);
    const after = adminEndSession(found, T0 + 6_000);
    expect(after.status).toBe("FOUND");
  });
});

describe("admin live clock adjustments", () => {
  it("shifts the global deadline without touching the current try", () => {
    const session = startSession(SECRET, T0);
    const after = adjustGlobalDeadline(session, 60_000);
    expect(after.globalDeadlineAt).toBe(T0 + 360_000 + 60_000);
    expect(after.currentTryDeadlineAt).toBe(session.currentTryDeadlineAt);
  });

  it("shifts only the current try's (and grace's) deadline", () => {
    let session = startSession(SECRET, T0);
    session = openGrace(session, T0 + TRY_BUDGET_MS);
    const after = adjustCurrentTryDeadline(session, 15_000);
    expect(after.currentTryDeadlineAt).toBe(T0 + TRY_BUDGET_MS + 15_000);
    expect(after.graceDeadlineAt).toBe(T0 + TRY_BUDGET_MS + GRACE_MS + 15_000);
    expect(after.globalDeadlineAt).toBe(session.globalDeadlineAt);
  });
});

describe("independence of time-banking and grace penalty (PRD §3.4)", () => {
  it("lets a docked try still bank surplus if submitted early within its (docked) budget", () => {
    let session = startSession(SECRET, T0);
    // Try 1: trigger grace (submit at 75s)
    let result = applyGuess(session, "STORY", T0 + 75_000);
    session = result.session;
    expect(session.currentTryBudgetMs).toBe(TRY_BUDGET_MS - GRACE_DOCK_MS); // 30s

    // Try 2 (docked to 30s budget): submit after only 5s -> 25s surplus banked
    const try2Start = session.currentTryStartedAt;
    result = applyGuess(session, "STORY", try2Start + 5_000);
    session = result.session;
    expect(session.bankedSurplusMs).toBe(25_000);
    expect(session.currentTryBudgetMs).toBe(TRY_BUDGET_MS); // try 3 has no dock of its own
  });
});
