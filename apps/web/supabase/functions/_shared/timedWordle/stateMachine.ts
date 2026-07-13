// Verbatim port of apps/api/src/modules/timed-wordle/engine/stateMachine.ts —
// same pure functions, no Node-specific dependencies, only the import
// extensions changed for Deno's module resolution.
import { GLOBAL_CAP_MS, GRACE_DOCK_MS, GRACE_MS, MAX_TRIES, TRY_BUDGET_MS } from "./constants.ts";
import { computeFeedback, computeTileScore, type TileColor } from "./scoring.ts";

export type TimedWordleStatus =
  | "IN_PROGRESS"
  | "FOUND"
  | "NOT_FOUND_TRIES"
  | "NOT_FOUND_TIME"
  | "ADMIN_ENDED";

export type TryStatus = "SUBMITTED" | "SKIPPED";

export interface TimedWordleTry {
  tryNumber: number;
  status: TryStatus;
  guess: string | null;
  feedback: TileColor[] | null;
  budgetMs: number;
  timeUsedMs: number;
  usedGrace: boolean;
  resolvedAt: number;
}

export interface TimedWordleSession {
  secret: string;
  status: TimedWordleStatus;
  sessionStartedAt: number;
  globalDeadlineAt: number;
  currentTryNumber: number;
  currentTryStartedAt: number;
  currentTryBudgetMs: number;
  currentTryDeadlineAt: number;
  graceActive: boolean;
  graceDeadlineAt: number | null;
  bankedSurplusMs: number;
  tries: TimedWordleTry[];
  gameEndedAt: number | null;
  found: boolean;
  cumulativeTimeMs: number;
  triesUsed: number;
  tileScore: number;
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

function computeNextTryBudget(nextTryNumber: number, dockNextTry: boolean, bankedSurplusMs: number): number {
  let budget = TRY_BUDGET_MS - (dockNextTry ? GRACE_DOCK_MS : 0);
  if (nextTryNumber === MAX_TRIES) {
    budget += bankedSurplusMs;
  }
  return budget;
}

export function startSession(secret: string, now: number): TimedWordleSession {
  const budget = TRY_BUDGET_MS;
  return {
    secret: secret.toUpperCase(),
    status: "IN_PROGRESS",
    sessionStartedAt: now,
    globalDeadlineAt: now + GLOBAL_CAP_MS,
    currentTryNumber: 1,
    currentTryStartedAt: now,
    currentTryBudgetMs: budget,
    currentTryDeadlineAt: now + budget,
    graceActive: false,
    graceDeadlineAt: null,
    bankedSurplusMs: 0,
    tries: [],
    gameEndedAt: null,
    found: false,
    cumulativeTimeMs: 0,
    triesUsed: 0,
    tileScore: 0,
  };
}

function finalize(session: TimedWordleSession, status: TimedWordleStatus, now: number): TimedWordleSession {
  const found = status === "FOUND";
  const cumulativeTimeMs = found ? now - session.sessionStartedAt : GLOBAL_CAP_MS;
  const feedbacks = session.tries.map((t) => t.feedback);
  const { total } = computeTileScore(session.secret, feedbacks);

  return {
    ...session,
    status,
    gameEndedAt: now,
    found,
    cumulativeTimeMs,
    triesUsed: session.tries.length,
    tileScore: total,
  };
}

export interface ApplyGuessResult {
  session: TimedWordleSession;
  feedback: TileColor[];
}

/** Player submits a guess for the current try. `now` must be within the try's
 * budget+grace window — callers (the reconcile step) are responsible for having
 * already auto-skipped tries whose grace window fully elapsed. */
export function applyGuess(session: TimedWordleSession, guess: string, now: number): ApplyGuessResult {
  if (session.status !== "IN_PROGRESS") {
    throw new InvalidTransitionError(`Cannot submit a guess for a session in status ${session.status}`);
  }

  const graceCeiling = session.currentTryDeadlineAt + GRACE_MS;
  if (now > graceCeiling) {
    throw new InvalidTransitionError("Try's grace window has already elapsed");
  }
  if (now > session.globalDeadlineAt) {
    throw new InvalidTransitionError("Global game clock has already expired");
  }

  const feedback = computeFeedback(guess, session.secret);
  const timeUsedMs = now - session.currentTryStartedAt;
  const usedGrace = timeUsedMs > session.currentTryBudgetMs;
  const surplus = usedGrace ? 0 : session.currentTryBudgetMs - timeUsedMs;

  const tryRecord: TimedWordleTry = {
    tryNumber: session.currentTryNumber,
    status: "SUBMITTED",
    guess: guess.toUpperCase(),
    feedback,
    budgetMs: session.currentTryBudgetMs,
    timeUsedMs,
    usedGrace,
    resolvedAt: now,
  };

  const tries = [...session.tries, tryRecord];
  const bankedSurplusMs = session.bankedSurplusMs + surplus;
  const found = feedback.every((c) => c === "GREEN");

  let next: TimedWordleSession = { ...session, tries, bankedSurplusMs };

  if (found) {
    return { session: finalize(next, "FOUND", now), feedback };
  }

  if (session.currentTryNumber >= MAX_TRIES) {
    return { session: finalize(next, "NOT_FOUND_TRIES", now), feedback };
  }

  const nextTryNumber = session.currentTryNumber + 1;
  const nextBudget = computeNextTryBudget(nextTryNumber, usedGrace, bankedSurplusMs);

  next = {
    ...next,
    currentTryNumber: nextTryNumber,
    currentTryStartedAt: now,
    currentTryBudgetMs: nextBudget,
    currentTryDeadlineAt: now + nextBudget,
    graceActive: false,
    graceDeadlineAt: null,
  };

  return { session: next, feedback };
}

/** Reconcile-driven: try's base budget has elapsed with no submission — open the grace window. */
export function openGrace(session: TimedWordleSession, now: number): TimedWordleSession {
  if (session.status !== "IN_PROGRESS" || session.graceActive) return session;
  if (now < session.currentTryDeadlineAt) return session;

  return {
    ...session,
    graceActive: true,
    graceDeadlineAt: session.currentTryDeadlineAt + GRACE_MS,
  };
}

/** Reconcile-driven: grace window fully elapsed with no submission — mark try SKIPPED and advance. */
export function skipCurrentTry(session: TimedWordleSession, now: number): TimedWordleSession {
  if (session.status !== "IN_PROGRESS") return session;

  const graceCeiling = session.currentTryDeadlineAt + GRACE_MS;
  if (now < graceCeiling) return session;

  const tryRecord: TimedWordleTry = {
    tryNumber: session.currentTryNumber,
    status: "SKIPPED",
    guess: null,
    feedback: null,
    budgetMs: session.currentTryBudgetMs,
    timeUsedMs: graceCeiling - session.currentTryStartedAt,
    usedGrace: true,
    resolvedAt: now,
  };

  const tries = [...session.tries, tryRecord];
  const next: TimedWordleSession = { ...session, tries };

  if (session.currentTryNumber >= MAX_TRIES) {
    return finalize(next, "NOT_FOUND_TRIES", now);
  }

  const nextTryNumber = session.currentTryNumber + 1;
  const nextBudget = computeNextTryBudget(nextTryNumber, true, session.bankedSurplusMs);

  return {
    ...next,
    currentTryNumber: nextTryNumber,
    currentTryStartedAt: now,
    currentTryBudgetMs: nextBudget,
    currentTryDeadlineAt: now + nextBudget,
    graceActive: false,
    graceDeadlineAt: null,
  };
}

/** Reconcile-driven: the global 360s clock has expired — force-end immediately,
 * regardless of the current try's in-progress state (PRD §3.5). */
export function forceEndOnGlobalTimeout(session: TimedWordleSession, now: number): TimedWordleSession {
  if (session.status !== "IN_PROGRESS") return session;
  if (now < session.globalDeadlineAt) return session;

  const tryRecord: TimedWordleTry = {
    tryNumber: session.currentTryNumber,
    status: "SKIPPED",
    guess: null,
    feedback: null,
    budgetMs: session.currentTryBudgetMs,
    timeUsedMs: now - session.currentTryStartedAt,
    usedGrace: now - session.currentTryStartedAt > session.currentTryBudgetMs,
    resolvedAt: now,
  };

  return finalize({ ...session, tries: [...session.tries, tryRecord] }, "NOT_FOUND_TIME", now);
}

/** Admin force-ends the session mid-game. Treated as a normal loss with whatever
 * cumulative time/tries/tiles had accumulated (PRD §5.4) — the interrupted try is
 * recorded as SKIPPED, consistent with how a global-timeout mid-try is handled. */
export function adminEndSession(session: TimedWordleSession, now: number): TimedWordleSession {
  if (session.status !== "IN_PROGRESS") return session;

  const tryRecord: TimedWordleTry = {
    tryNumber: session.currentTryNumber,
    status: "SKIPPED",
    guess: null,
    feedback: null,
    budgetMs: session.currentTryBudgetMs,
    timeUsedMs: now - session.currentTryStartedAt,
    usedGrace: now - session.currentTryStartedAt > session.currentTryBudgetMs,
    resolvedAt: now,
  };

  return finalize({ ...session, tries: [...session.tries, tryRecord] }, "ADMIN_ENDED", now);
}

/** Admin live clock-adjust: shifts the whole session's global deadline (e.g. cohort-wide delay). */
export function adjustGlobalDeadline(session: TimedWordleSession, deltaMs: number): TimedWordleSession {
  return { ...session, globalDeadlineAt: session.globalDeadlineAt + deltaMs };
}

/** Admin live clock-adjust: shifts only the active try's deadline (and grace deadline, if open). */
export function adjustCurrentTryDeadline(session: TimedWordleSession, deltaMs: number): TimedWordleSession {
  return {
    ...session,
    currentTryBudgetMs: session.currentTryBudgetMs + deltaMs,
    currentTryDeadlineAt: session.currentTryDeadlineAt + deltaMs,
    graceDeadlineAt: session.graceDeadlineAt !== null ? session.graceDeadlineAt + deltaMs : null,
  };
}
