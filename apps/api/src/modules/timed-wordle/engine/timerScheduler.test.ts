import { describe, expect, it, vi } from "vitest";
import { TimedWordleScheduler, type TimedWordleSchedulerDeps } from "./timerScheduler.js";
import { startSession } from "./stateMachine.js";
import { GRACE_MS, TRY_BUDGET_MS } from "./constants.js";

const T0 = 1_700_000_000_000;
const SECRET = "CRANE";
const EVENT_ID = 1;
const SESSION_ID = 42;

function makeDeps(clock: { now: number }): TimedWordleSchedulerDeps & {
  emittedPlayerEvents: Array<{ sessionId: number; event: string; payload: unknown }>;
  emittedAdminEvents: Array<{ eventId: number; event: string; payload: unknown }>;
} {
  const emittedPlayerEvents: Array<{ sessionId: number; event: string; payload: unknown }> = [];
  const emittedAdminEvents: Array<{ eventId: number; event: string; payload: unknown }> = [];

  return {
    persistSession: vi.fn(async () => {}),
    persistTry: vi.fn(async () => {}),
    emitToPlayerSession: (sessionId, event, payload) => {
      emittedPlayerEvents.push({ sessionId, event, payload });
    },
    emitToAdminEvent: (eventId, event, payload) => {
      emittedAdminEvents.push({ eventId, event, payload });
    },
    now: () => clock.now,
    emittedPlayerEvents,
    emittedAdminEvents,
  };
}

describe("TimedWordleScheduler — tick-driven transitions", () => {
  it("opens grace once the try budget elapses with no submission", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    scheduler.register(SESSION_ID, EVENT_ID, startSession(SECRET, T0));

    clock.now = T0 + TRY_BUDGET_MS;
    await scheduler.tick();

    expect(scheduler.getState(SESSION_ID)?.graceActive).toBe(true);
    expect(deps.emittedPlayerEvents.some((e) => e.event === "tw:grace:opened")).toBe(true);
  });

  it("marks the try SKIPPED and advances once the full grace window elapses", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    scheduler.register(SESSION_ID, EVENT_ID, startSession(SECRET, T0));

    clock.now = T0 + TRY_BUDGET_MS;
    await scheduler.tick();
    clock.now = T0 + TRY_BUDGET_MS + GRACE_MS;
    await scheduler.tick();

    const state = scheduler.getState(SESSION_ID);
    expect(state?.currentTryNumber).toBe(2);
    expect(state?.tries[0].status).toBe("SKIPPED");
    expect(deps.emittedPlayerEvents.some((e) => e.event === "tw:try:advance")).toBe(true);
    expect(deps.persistTry).toHaveBeenCalled();
  });

  it("force-ends the game and unregisters the session once the global clock expires", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    scheduler.register(SESSION_ID, EVENT_ID, startSession(SECRET, T0));

    clock.now = T0 + 360_000;
    await scheduler.tick();

    expect(scheduler.isActive(SESSION_ID)).toBe(false);
    const endedEvent = deps.emittedPlayerEvents.find((e) => e.event === "tw:game:ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent!.payload as { reason: string }).reason).toBe("time_expired");

    const adminEvent = deps.emittedAdminEvents.find((e) => e.event === "admin:session:update");
    expect(adminEvent).toBeDefined();
  });

  it("does nothing for sessions that are not IN_PROGRESS", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    const found = { ...startSession(SECRET, T0), status: "FOUND" as const };
    scheduler.register(SESSION_ID, EVENT_ID, found);
    // register() only adds IN_PROGRESS sessions, so this session should never be tracked
    expect(scheduler.isActive(SESSION_ID)).toBe(false);
  });
});

describe("TimedWordleScheduler — submitGuess", () => {
  it("advances to the next try on a non-winning guess and persists the try", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    scheduler.register(SESSION_ID, EVENT_ID, startSession(SECRET, T0));

    const { feedback, state } = await scheduler.submitGuess(SESSION_ID, "STORY", T0 + 5000);
    expect(feedback).toHaveLength(5);
    expect(state.currentTryNumber).toBe(2);
    expect(deps.emittedPlayerEvents.some((e) => e.event === "tw:try:advance")).toBe(true);
  });

  it("ends the game and unregisters the session on a winning guess", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    scheduler.register(SESSION_ID, EVENT_ID, startSession(SECRET, T0));

    const { state } = await scheduler.submitGuess(SESSION_ID, SECRET, T0 + 5000);
    expect(state.status).toBe("FOUND");
    expect(scheduler.isActive(SESSION_ID)).toBe(false);
    expect(deps.emittedPlayerEvents.some((e) => e.event === "tw:game:ended")).toBe(true);
  });

  it("throws if the session is not currently active", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    await expect(scheduler.submitGuess(999, "STORY", T0)).rejects.toThrow();
  });
});

describe("TimedWordleScheduler — admin controls", () => {
  it("adminEnd force-finalizes and unregisters the session", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    scheduler.register(SESSION_ID, EVENT_ID, startSession(SECRET, T0));

    const state = await scheduler.adminEnd(SESSION_ID, T0 + 10_000);
    expect(state.status).toBe("ADMIN_ENDED");
    expect(scheduler.isActive(SESSION_ID)).toBe(false);
  });

  it("adjustGlobal shifts the deadline and notifies the player", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    const initial = startSession(SECRET, T0);
    scheduler.register(SESSION_ID, EVENT_ID, initial);

    const state = await scheduler.adjustGlobal(SESSION_ID, 60_000);
    expect(state.globalDeadlineAt).toBe(initial.globalDeadlineAt + 60_000);
    expect(deps.emittedPlayerEvents.some((e) => e.event === "admin:clock:adjusted")).toBe(true);
  });

  it("adjustCurrentTry shifts only the active try's deadline", async () => {
    const clock = { now: T0 };
    const deps = makeDeps(clock);
    const scheduler = new TimedWordleScheduler(deps);
    const initial = startSession(SECRET, T0);
    scheduler.register(SESSION_ID, EVENT_ID, initial);

    const state = await scheduler.adjustCurrentTry(SESSION_ID, 15_000);
    expect(state.currentTryDeadlineAt).toBe(initial.currentTryDeadlineAt + 15_000);
    expect(state.globalDeadlineAt).toBe(initial.globalDeadlineAt);
  });
});
