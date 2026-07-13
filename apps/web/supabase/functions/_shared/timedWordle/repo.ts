import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  forceEndOnGlobalTimeout,
  openGrace,
  skipCurrentTry,
  type TimedWordleSession,
  type TimedWordleTry,
} from "./stateMachine.ts";

export interface TimedWordleSessionRow {
  id: number;
  puzzle_id: number;
  event_player_id: number;
  status: string;
  session_started_at: string | null;
  global_deadline_at: string | null;
  current_try_number: number;
  current_try_started_at: string | null;
  current_try_budget_ms: number | null;
  current_try_deadline_at: string | null;
  grace_active: boolean;
  grace_deadline_at: string | null;
  banked_surplus_ms: number;
  found: boolean;
  cumulative_time_ms: number | null;
  tries_used: number | null;
  tile_score: number | null;
  game_ended_at: string | null;
  advanced_to_playoffs: boolean;
  advanced_at: string | null;
  had_admin_clock_adjustment: boolean;
  total_adjustment_ms: number;
  last_activity_at: string | null;
  row_version: number;
}

export interface TimedWordleTryRow {
  id: number;
  session_id: number;
  try_number: number;
  status: "SUBMITTED" | "SKIPPED";
  guess: string | null;
  feedback: unknown;
  budget_ms: number;
  time_used_ms: number;
  used_grace: boolean;
  resolved_at: string;
}

function toMs(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}
function toMsOrNull(iso: string | null): number | null {
  return iso ? new Date(iso).getTime() : null;
}

/** Port of tw.repo.ts's hydrateSession, adapted for Supabase's ISO-string timestamps. */
export function hydrateSession(row: TimedWordleSessionRow, tries: TimedWordleTryRow[], secretWord: string): TimedWordleSession {
  return {
    secret: secretWord.toUpperCase(),
    status: row.status as TimedWordleSession["status"],
    sessionStartedAt: toMs(row.session_started_at),
    globalDeadlineAt: toMs(row.global_deadline_at),
    currentTryNumber: row.current_try_number,
    currentTryStartedAt: toMs(row.current_try_started_at),
    currentTryBudgetMs: row.current_try_budget_ms ?? 0,
    currentTryDeadlineAt: toMs(row.current_try_deadline_at),
    graceActive: row.grace_active,
    graceDeadlineAt: toMsOrNull(row.grace_deadline_at),
    bankedSurplusMs: row.banked_surplus_ms,
    tries: tries.map((t) => ({
      tryNumber: t.try_number,
      status: t.status,
      guess: t.guess,
      feedback: t.feedback as TimedWordleTry["feedback"],
      budgetMs: t.budget_ms,
      timeUsedMs: t.time_used_ms,
      usedGrace: t.used_grace,
      resolvedAt: toMs(t.resolved_at),
    })),
    gameEndedAt: toMsOrNull(row.game_ended_at),
    found: row.found,
    cumulativeTimeMs: row.cumulative_time_ms ?? 0,
    triesUsed: row.tries_used ?? 0,
    tileScore: row.tile_score ?? 0,
  };
}

function sessionToRowPatch(state: TimedWordleSession): Record<string, unknown> {
  return {
    status: state.status,
    session_started_at: new Date(state.sessionStartedAt).toISOString(),
    global_deadline_at: new Date(state.globalDeadlineAt).toISOString(),
    current_try_number: state.currentTryNumber,
    current_try_started_at: new Date(state.currentTryStartedAt).toISOString(),
    current_try_budget_ms: state.currentTryBudgetMs,
    current_try_deadline_at: new Date(state.currentTryDeadlineAt).toISOString(),
    grace_active: state.graceActive,
    grace_deadline_at: state.graceDeadlineAt !== null ? new Date(state.graceDeadlineAt).toISOString() : null,
    banked_surplus_ms: state.bankedSurplusMs,
    found: state.found,
    cumulative_time_ms: state.cumulativeTimeMs,
    tries_used: state.triesUsed,
    tile_score: state.tileScore,
    game_ended_at: state.gameEndedAt !== null ? new Date(state.gameEndedAt).toISOString() : null,
    last_activity_at: new Date().toISOString(),
  };
}

/** Loads a session (+ its puzzle's secret word + tries), applies any timer
 * transitions that are due (the on-demand replacement for timerScheduler.ts's
 * 500ms scan loop), persists the result with an optimistic-concurrency check,
 * and returns the reconciled state. Loops because a session nobody has
 * touched in a while may need to catch up through several skipped tries at
 * once, not just the one the original loop would have caught on its next tick. */
export async function loadAndReconcile(
  db: SupabaseClient,
  sessionId: number,
  now: number
): Promise<{ row: TimedWordleSessionRow; state: TimedWordleSession; secretWord: string; definition: string | null } | null> {
  const { data: row } = await db
    .from("wl_timed_wordle_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle<TimedWordleSessionRow>();
  if (!row) return null;

  const { data: puzzle } = await db
    .from("wl_timed_wordle_puzzles")
    .select("secret_word, definition")
    .eq("id", row.puzzle_id)
    .maybeSingle();
  if (!puzzle) return null;

  const { data: tries } = await db
    .from("wl_timed_wordle_tries")
    .select("*")
    .eq("session_id", sessionId)
    .order("try_number", { ascending: true });

  let state = hydrateSession(row, (tries ?? []) as TimedWordleTryRow[], puzzle.secret_word);

  if (row.status !== "IN_PROGRESS") {
    return { row, state, secretWord: puzzle.secret_word, definition: puzzle.definition };
  }

  const triesBefore = state.tries.length;
  let changed = false;
  for (let i = 0; i < 10 && state.status === "IN_PROGRESS"; i++) {
    if (now >= state.globalDeadlineAt) {
      state = forceEndOnGlobalTimeout(state, now);
      changed = true;
      break;
    }
    if (!state.graceActive && now >= state.currentTryDeadlineAt) {
      state = openGrace(state, now);
      changed = true;
      continue;
    }
    if (state.graceActive && state.graceDeadlineAt !== null && now >= state.graceDeadlineAt) {
      const before = state.status;
      state = skipCurrentTry(state, now);
      changed = changed || state.status !== before || true;
      continue;
    }
    break;
  }

  if (changed) {
    await persistSessionAndNewTries(db, sessionId, row.row_version, state, triesBefore);
  }

  return { row, state, secretWord: puzzle.secret_word, definition: puzzle.definition };
}

/** Persists a mutated state + any newly-appended try records, using row_version
 * as an optimistic-concurrency guard (see the plan's "event-driven timers, no
 * raw pg connections" design) — retries once on conflict, which in practice
 * should be exceedingly rare since a given session only has one real writer
 * (its own player) plus this reconcile step. */
export async function persistSessionAndNewTries(
  db: SupabaseClient,
  sessionId: number,
  expectedRowVersion: number,
  state: TimedWordleSession,
  triesBefore: number
): Promise<boolean> {
  const patch = { ...sessionToRowPatch(state), row_version: expectedRowVersion + 1 };

  const { data: updated, error } = await db
    .from("wl_timed_wordle_sessions")
    .update(patch)
    .eq("id", sessionId)
    .eq("row_version", expectedRowVersion)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) return false; // lost the optimistic-concurrency race; caller may retry

  const newTries = state.tries.slice(triesBefore);
  for (const t of newTries) {
    const { error: tryErr } = await db.from("wl_timed_wordle_tries").upsert(
      {
        session_id: sessionId,
        try_number: t.tryNumber,
        status: t.status,
        guess: t.guess,
        feedback: t.feedback,
        budget_ms: t.budgetMs,
        time_used_ms: t.timeUsedMs,
        used_grace: t.usedGrace,
        resolved_at: new Date(t.resolvedAt).toISOString(),
      },
      { onConflict: "session_id,try_number" }
    );
    if (tryErr) throw tryErr;
  }

  return true;
}
