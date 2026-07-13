import {
  adjustCurrentTryDeadline,
  adjustGlobalDeadline,
  adminEndSession,
  applyGuess,
  forceEndOnGlobalTimeout,
  InvalidTransitionError,
  openGrace,
  skipCurrentTry,
  type TimedWordleSession,
} from "./stateMachine.js";
import type { TileColor } from "./scoring.js";

export interface TimedWordleSchedulerDeps {
  persistSession: (sessionId: number, session: TimedWordleSession) => Promise<void>;
  persistTry: (sessionId: number, tryRecord: TimedWordleSession["tries"][number]) => Promise<void>;
  emitToPlayerSession: (sessionId: number, event: string, payload: unknown) => void;
  emitToAdminEvent: (eventId: number, event: string, payload: unknown) => void;
  now?: () => number;
}

interface SessionEntry {
  eventId: number;
  definition: string | null;
  state: TimedWordleSession;
}

/**
 * Single in-process scan loop driving every active Timed Wordle session's timer.
 * O(activeSessions) per tick — trivial at the platform's 600-concurrent-session scale
 * (see PRD implementation plan §3, "no Redis for v1"). Every transition is persisted
 * synchronously so a restart can recover in-flight sessions from Postgres.
 */
export class TimedWordleScheduler {
  private sessions = new Map<number, SessionEntry>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: TimedWordleSchedulerDeps,
    private readonly tickIntervalMs = 500
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Adds a session to the live scan set (e.g. on player start, or on server-boot recovery). */
  register(sessionId: number, eventId: number, state: TimedWordleSession, definition: string | null = null): void {
    if (state.status === "IN_PROGRESS") {
      this.sessions.set(sessionId, { eventId, definition, state });
    }
  }

  unregister(sessionId: number): void {
    this.sessions.delete(sessionId);
  }

  getState(sessionId: number): TimedWordleSession | undefined {
    return this.sessions.get(sessionId)?.state;
  }

  isActive(sessionId: number): boolean {
    return this.sessions.has(sessionId);
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  /** Runs one scan pass over every active session. Exposed directly for deterministic unit tests. */
  async tick(): Promise<void> {
    const now = this.now();
    for (const sessionId of [...this.sessions.keys()]) {
      await this.evaluateSession(sessionId, now);
    }
  }

  private async evaluateSession(sessionId: number, now: number): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    let { state } = entry;
    const { eventId, definition } = entry;

    if (state.status !== "IN_PROGRESS") {
      this.sessions.delete(sessionId);
      return;
    }

    if (now >= state.globalDeadlineAt) {
      const triesBefore = state.tries.length;
      state = forceEndOnGlobalTimeout(state, now);
      await this.persistAndAnnounceEnd(sessionId, eventId, definition, state, triesBefore);
      return;
    }

    if (!state.graceActive && now >= state.currentTryDeadlineAt) {
      state = openGrace(state, now);
      this.sessions.set(sessionId, { eventId, definition, state });
      await this.deps.persistSession(sessionId, state);
      this.deps.emitToPlayerSession(sessionId, "tw:grace:opened", {
        sessionId,
        tryNumber: state.currentTryNumber,
        graceDeadlineAt: state.graceDeadlineAt,
      });
      return;
    }

    if (state.graceActive && state.graceDeadlineAt !== null && now >= state.graceDeadlineAt) {
      const triesBefore = state.tries.length;
      state = skipCurrentTry(state, now);

      if (state.status === "IN_PROGRESS") {
        this.sessions.set(sessionId, { eventId, definition, state });
        await this.deps.persistSession(sessionId, state);
        await this.deps.persistTry(sessionId, state.tries[state.tries.length - 1]);
        this.deps.emitToPlayerSession(sessionId, "tw:try:advance", {
          sessionId,
          tryNumber: state.currentTryNumber,
          skipped: true,
          tryDeadlineAt: state.currentTryDeadlineAt,
          bankedMs: state.bankedSurplusMs,
        });
      } else {
        await this.persistAndAnnounceEnd(sessionId, eventId, definition, state, triesBefore);
      }
    }
  }

  private async persistAndAnnounceEnd(
    sessionId: number,
    eventId: number,
    definition: string | null,
    state: TimedWordleSession,
    triesBefore: number
  ): Promise<void> {
    this.sessions.delete(sessionId);
    await this.deps.persistSession(sessionId, state);
    if (state.tries.length > triesBefore) {
      await this.deps.persistTry(sessionId, state.tries[state.tries.length - 1]);
    }

    this.deps.emitToPlayerSession(sessionId, "tw:game:ended", {
      sessionId,
      reason: mapStatusToEndReason(state.status),
      secretWord: state.secret,
      definition,
      summary: {
        found: state.found,
        cumulativeTimeMs: state.cumulativeTimeMs,
        triesUsed: state.triesUsed,
        tileScore: state.tileScore,
      },
    });

    this.deps.emitToAdminEvent(eventId, "admin:session:update", {
      sessionId,
      patch: { status: state.status, lastActivityAt: new Date(this.now()).toISOString() },
    });
  }

  /** Player submits a guess for their currently active try. */
  async submitGuess(
    sessionId: number,
    guess: string,
    now: number
  ): Promise<{ feedback: TileColor[]; state: TimedWordleSession }> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new InvalidTransitionError("Session is not active");

    const triesBefore = entry.state.tries.length;
    const { feedback, session } = applyGuess(entry.state, guess, now);

    if (session.status === "IN_PROGRESS") {
      this.sessions.set(sessionId, { eventId: entry.eventId, definition: entry.definition, state: session });
      await this.deps.persistSession(sessionId, session);
      await this.deps.persistTry(sessionId, session.tries[session.tries.length - 1]);
      this.deps.emitToPlayerSession(sessionId, "tw:try:advance", {
        sessionId,
        tryNumber: session.currentTryNumber,
        skipped: false,
        tryDeadlineAt: session.currentTryDeadlineAt,
        bankedMs: session.bankedSurplusMs,
      });
    } else {
      await this.persistAndAnnounceEnd(sessionId, entry.eventId, entry.definition, session, triesBefore);
    }

    return { feedback, state: session };
  }

  /** Admin force-ends a session mid-game (individual or looped for bulk by the caller). */
  async adminEnd(sessionId: number, now: number): Promise<TimedWordleSession> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new InvalidTransitionError("Session is not active");

    const triesBefore = entry.state.tries.length;
    const state = adminEndSession(entry.state, now);
    await this.persistAndAnnounceEnd(sessionId, entry.eventId, entry.definition, state, triesBefore);
    return state;
  }

  /** Admin live clock-adjust: shifts the whole session's global deadline. */
  async adjustGlobal(sessionId: number, deltaMs: number): Promise<TimedWordleSession> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new InvalidTransitionError("Session is not active");

    const state = adjustGlobalDeadline(entry.state, deltaMs);
    this.sessions.set(sessionId, { eventId: entry.eventId, definition: entry.definition, state });
    await this.deps.persistSession(sessionId, state);
    this.deps.emitToPlayerSession(sessionId, "admin:clock:adjusted", {
      sessionId,
      scope: "global",
      deltaMs,
      newDeadlineAt: state.globalDeadlineAt,
    });
    return state;
  }

  /** Admin live clock-adjust: shifts only the current try's (and grace's) deadline. */
  async adjustCurrentTry(sessionId: number, deltaMs: number): Promise<TimedWordleSession> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new InvalidTransitionError("Session is not active");

    const state = adjustCurrentTryDeadline(entry.state, deltaMs);
    this.sessions.set(sessionId, { eventId: entry.eventId, definition: entry.definition, state });
    await this.deps.persistSession(sessionId, state);
    this.deps.emitToPlayerSession(sessionId, "admin:clock:adjusted", {
      sessionId,
      scope: "current_try",
      deltaMs,
      newDeadlineAt: state.currentTryDeadlineAt,
    });
    return state;
  }
}

export function mapStatusToEndReason(
  status: TimedWordleSession["status"]
): "solved" | "tries_exhausted" | "time_expired" | "admin_forced" | "unknown" {
  switch (status) {
    case "FOUND":
      return "solved";
    case "NOT_FOUND_TRIES":
      return "tries_exhausted";
    case "NOT_FOUND_TIME":
      return "time_expired";
    case "ADMIN_ENDED":
      return "admin_forced";
    default:
      return "unknown";
  }
}
