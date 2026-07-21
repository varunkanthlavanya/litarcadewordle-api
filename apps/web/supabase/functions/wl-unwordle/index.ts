// Port of apps/api/src/modules/unwordle/{uw.routes,uw.service,uw.repo,uw.sockets}.ts
//
// Rewritten for the continuous-round Playoffs model
// (PRD/UNWORDLE_PLAYOFFS_ROUND_PRD.md, Revision 3): a bank of many puzzles
// per event, played by every advanced player in the same fixed order with
// zero admin action between puzzles, for a fixed, admin-configured
// duration. Session load/hydrate/persist/reconcile logic lives in
// _shared/unwordle/roundRepo.ts; this file is route dispatch + the
// round-scoped aggregation (points, monitor state, leaderboard) that's
// specific to how these routes present that data.
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireAdmin, requirePlayer, AuthError } from "../_shared/auth.ts";
import { writeAuditEntry } from "../_shared/audit.ts";
import { isValidGuessWord } from "../_shared/dictionary/index.ts";
import { VALID_GUESS_WORDS } from "../_shared/dictionary/validGuesses.ts";
import { adminEndSession, playerExitSession, submitWord, type UnwordleSession } from "../_shared/unwordle/stateMachine.ts";
import { checkRowSatisfiability, validatePuzzlePatterns } from "../_shared/unwordle/puzzleValidator.ts";
import type { TileColor } from "../_shared/unwordle/validation.ts";
import {
  computeFreebieRows,
  createAndStartSessionCascading,
  hydrateSession,
  loadSessionAndPuzzle,
  persistRow,
  persistSession,
  reconcileRoundForPlayer,
  type BankPuzzleRow,
  type RowRow,
  type SessionRow,
} from "../_shared/unwordle/roundRepo.ts";

const ROWS_PER_PUZZLE = 4;
const ROW_LENGTH = 5;

function isValidPattern(pattern: unknown): pattern is TileColor[] {
  return Array.isArray(pattern) && pattern.length === ROW_LENGTH && pattern.every((c) => c === "GREEN" || c === "YELLOW" || c === "GRAY");
}

function toBankPuzzleDto(p: BankPuzzleRow) {
  return { id: p.id, puzzleNumber: p.puzzle_number, solutionWord: p.solution_word, rowPatterns: p.row_patterns, status: p.status };
}

function buildEndedPayload(sessionId: number, reason: "completed" | "admin_ended", session: UnwordleSession) {
  return {
    sessionId,
    reason,
    solutionWord: session.solution,
    revealedAnswers: session.rows.map((r) => {
      if (r.solvedWord) return r.solvedWord;
      return checkRowSatisfiability(session.solution, r.pattern, VALID_GUESS_WORDS, 1).sampleWords[0] ?? "";
    }),
    summary: {
      rowsSolvedCount: session.rowsSolvedCount,
      totalTimeMs: session.totalTimeMs,
      totalAttempts: session.totalAttempts,
      totalInvalidSubmissions: session.totalInvalidSubmissions,
    },
    rows: session.rows,
  };
}

function toStateDto(state: UnwordleSession) {
  return {
    status: state.status,
    startTime: state.startTime,
    rows: state.rows,
    rowsSolvedCount: state.rowsSolvedCount,
    totalTimeMs: state.totalTimeMs,
    totalAttempts: state.totalAttempts,
    totalInvalidSubmissions: state.totalInvalidSubmissions,
    solutionWord: state.solution,
  };
}

// ===================== Round-scoped aggregation =====================
// The unit of "who's on the leaderboard / in the monitor" is now every
// advanced-to-playoffs player (from Timed Wordle's advanced_to_playoffs
// flag), left-joined to however many wl_unwordle_sessions rows they have
// across the whole bank — not "everyone with a session for the one
// puzzle" like the old single-puzzle model. This is what lets a player who
// was advanced but never got a session (a reachable state now that
// session creation only happens at Start Round, not automatically at
// cutoff-confirm time) still show up at 0 points instead of being silently
// dropped.

interface PlayerRoundAggregate {
  eventPlayerId: number;
  displayName: string | null;
  mobileNumber: string;
  sessions: Array<{
    id: number;
    puzzleNumber: number;
    status: string;
    rowsSolvedCount: number;
    totalAttempts: number;
    totalInvalidSubmissions: number;
  }>;
}

async function loadAdvancedPlayersWithSessions(db: ReturnType<typeof supabaseAdmin>, eventId: number): Promise<PlayerRoundAggregate[]> {
  const { data: twPuzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
  let advancedPlayerIds: number[] = [];
  if (twPuzzle) {
    const { data: advancedRows } = await db
      .from("wl_timed_wordle_sessions")
      .select("event_player_id")
      .eq("puzzle_id", twPuzzle.id)
      .eq("advanced_to_playoffs", true);
    advancedPlayerIds = (advancedRows ?? []).map((r) => r.event_player_id);
  }
  if (advancedPlayerIds.length === 0) return [];

  const { data: players } = await db
    .from("wl_event_players")
    .select("id, display_name, mobile_number")
    .in("id", advancedPlayerIds);

  const { data: bankPuzzles } = await db.from("wl_unwordle_puzzles").select("id, puzzle_number").eq("event_id", eventId);
  const puzzleNumberById = new Map((bankPuzzles ?? []).map((p) => [p.id, p.puzzle_number]));
  const puzzleIds = (bankPuzzles ?? []).map((p) => p.id);

  const sessionsByPlayer = new Map<number, PlayerRoundAggregate["sessions"]>();
  if (puzzleIds.length > 0) {
    const { data: sessions } = await db
      .from("wl_unwordle_sessions")
      .select("id, event_player_id, puzzle_id, status, rows_solved_count, total_attempts, total_invalid_submissions")
      .in("puzzle_id", puzzleIds);
    for (const s of sessions ?? []) {
      const list = sessionsByPlayer.get(s.event_player_id) ?? [];
      list.push({
        id: s.id,
        puzzleNumber: puzzleNumberById.get(s.puzzle_id) ?? 0,
        status: s.status,
        rowsSolvedCount: s.rows_solved_count,
        totalAttempts: s.total_attempts,
        totalInvalidSubmissions: s.total_invalid_submissions,
      });
      sessionsByPlayer.set(s.event_player_id, list);
    }
  }

  return (players ?? []).map((p) => ({
    eventPlayerId: p.id,
    displayName: p.display_name,
    mobileNumber: p.mobile_number,
    sessions: (sessionsByPlayer.get(p.id) ?? []).sort((a, b) => a.puzzleNumber - b.puzzleNumber),
  }));
}

function toMonitorEntry(agg: PlayerRoundAggregate, bankSize: number) {
  const sessions = agg.sessions;
  const totalPoints = sessions.reduce((sum, s) => sum + s.rowsSolvedCount * 25, 0);
  const totalPuzzlesCompleted = sessions.filter((s) => s.status === "COMPLETED").length;
  const totalAttempts = sessions.reduce((sum, s) => sum + s.totalAttempts, 0);
  const current = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  let monitorState: "PLAYING" | "BANK_EXHAUSTED" | "NOT_STARTED" | "EXITED_PAUSED" | "ROUND_ENDED";
  if (!current) monitorState = "NOT_STARTED";
  else if (current.status === "IN_PROGRESS") monitorState = "PLAYING";
  else if (current.status === "EXITED") monitorState = "EXITED_PAUSED";
  else if (current.status === "ENDED") monitorState = "ROUND_ENDED";
  else if (current.status === "COMPLETED" && current.puzzleNumber >= bankSize) monitorState = "BANK_EXHAUSTED";
  else monitorState = "PLAYING"; // defensive — a completed non-last puzzle should already have an auto-advanced session as "current"

  return {
    eventPlayerId: agg.eventPlayerId,
    displayName: agg.displayName,
    mobileNumber: agg.mobileNumber,
    sessionId: current?.id ?? null,
    puzzleNumber: current?.puzzleNumber ?? null,
    bankSize,
    rowsSolvedInCurrentPuzzle: current?.rowsSolvedCount ?? 0,
    totalPoints,
    totalPuzzlesCompleted,
    totalAttempts,
    monitorState,
  };
}

function toLeaderboardEntry(agg: PlayerRoundAggregate) {
  const sessions = agg.sessions;
  return {
    eventPlayerId: agg.eventPlayerId,
    displayName: agg.displayName,
    // Sorted ascending by puzzleNumber, so [0] is always puzzle #1 —
    // the round-start session — used only as the final deterministic
    // tie-break (PRD §8.3 tier 4).
    roundStartSessionId: sessions.length > 0 ? sessions[0].id : null,
    totalPoints: sessions.reduce((sum, s) => sum + s.rowsSolvedCount * 25, 0),
    totalPuzzlesCompleted: sessions.filter((s) => s.status === "COMPLETED").length,
    totalAttempts: sessions.reduce((sum, s) => sum + s.totalAttempts, 0),
    totalInvalidSubmissions: sessions.reduce((sum, s) => sum + s.totalInvalidSubmissions, 0),
  };
}

function compareLeaderboardEntries(
  a: ReturnType<typeof toLeaderboardEntry>,
  b: ReturnType<typeof toLeaderboardEntry>
): number {
  if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
  if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
  if (a.totalInvalidSubmissions !== b.totalInvalidSubmissions) return a.totalInvalidSubmissions - b.totalInvalidSubmissions;
  if (a.roundStartSessionId === null && b.roundStartSessionId === null) return 0;
  if (a.roundStartSessionId === null) return 1; // null sorts last
  if (b.roundStartSessionId === null) return -1;
  return a.roundStartSessionId - b.roundStartSessionId;
}

async function getRoundLeaderboard(db: ReturnType<typeof supabaseAdmin>, eventId: number) {
  const aggs = await loadAdvancedPlayersWithSessions(db, eventId);
  const entries = aggs.map(toLeaderboardEntry);
  entries.sort(compareLeaderboardEntries);
  return entries.map((e, index) => ({ ...e, rank: index + 1 }));
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const rest = segments.slice(1); // drop "wl-unwordle"
  const audience = rest[0];
  const db = supabaseAdmin();

  try {
    // ============================= ADMIN =============================
    if (audience === "admin") {
      const admin = await requireAdmin(req);
      const eventId = Number(rest[1]);
      if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);
      const action = rest.slice(2).join("/");

      // ---- Bank authoring ----

      if (action === "bank" && req.method === "GET") {
        const { data: event } = await db.from("wl_events").select("unwordle_bank_size").eq("id", eventId).maybeSingle();
        const { data: puzzles } = await db.from("wl_unwordle_puzzles").select("*").eq("event_id", eventId).order("puzzle_number");
        return json(req, {
          bankSize: event?.unwordle_bank_size ?? 25,
          puzzles: (puzzles ?? []).map((p) => toBankPuzzleDto(p as BankPuzzleRow)),
        });
      }

      if (action === "bank/upload" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const incoming: Array<{ puzzleNumber?: unknown; solutionWord?: unknown; rowPatterns?: unknown }> = Array.isArray(body.puzzles) ? body.puzzles : [];
        if (incoming.length === 0) return json(req, { error: "puzzles array is required" }, 400);

        const errors: Array<{ puzzleNumber: number | null; rowIndex: number | null; message: string }> = [];
        const seenNumbers = new Set<number>();
        const normalized: Array<{ puzzleNumber: number; solutionWord: string; rowPatterns: TileColor[][] }> = [];

        incoming.forEach((p, i) => {
          const puzzleNumber = Number(p.puzzleNumber);
          const solutionWord = typeof p.solutionWord === "string" ? p.solutionWord.trim().toUpperCase() : "";
          const rowPatterns = p.rowPatterns;

          if (!Number.isInteger(puzzleNumber) || puzzleNumber <= 0) {
            errors.push({ puzzleNumber: null, rowIndex: null, message: `Row ${i + 1}: invalid puzzle number` });
            return;
          }
          if (seenNumbers.has(puzzleNumber)) {
            errors.push({ puzzleNumber, rowIndex: null, message: `Puzzle ${puzzleNumber}: duplicate puzzle number in this upload` });
            return;
          }
          seenNumbers.add(puzzleNumber);

          if (solutionWord.length !== 5) {
            errors.push({ puzzleNumber, rowIndex: null, message: `Puzzle ${puzzleNumber}: solution word must be exactly 5 letters` });
            return;
          }
          if (!isValidGuessWord(solutionWord)) {
            errors.push({ puzzleNumber, rowIndex: null, message: `Puzzle ${puzzleNumber}: solution word must be a real dictionary word` });
            return;
          }
          if (!Array.isArray(rowPatterns) || rowPatterns.length !== ROWS_PER_PUZZLE || !rowPatterns.every(isValidPattern)) {
            errors.push({ puzzleNumber, rowIndex: null, message: `Puzzle ${puzzleNumber}: exactly ${ROWS_PER_PUZZLE} row patterns of ${ROW_LENGTH} tiles each are required` });
            return;
          }

          const validation = validatePuzzlePatterns(solutionWord, rowPatterns, VALID_GUESS_WORDS);
          if (!validation.valid) {
            for (const r of validation.rowResults.filter((r) => !r.satisfiable)) {
              errors.push({ puzzleNumber, rowIndex: r.rowIndex, message: `Puzzle ${puzzleNumber}, Row ${r.rowIndex + 1}: no valid dictionary word matches this pattern` });
            }
            return;
          }

          normalized.push({ puzzleNumber, solutionWord, rowPatterns: rowPatterns as TileColor[][] });
        });

        // Structural check within this upload's own numbers only — a
        // partial top-up upload (e.g. just puzzles 21-25) is a supported
        // path, so gaps are only flagged relative to what was submitted.
        if (errors.length === 0) {
          const numbers = normalized.map((p) => p.puzzleNumber).sort((a, b) => a - b);
          for (let i = 1; i < numbers.length; i++) {
            if (numbers[i] !== numbers[i - 1] + 1) {
              errors.push({ puzzleNumber: null, rowIndex: null, message: `Puzzle numbers must be consecutive with no gaps — found a gap between ${numbers[i - 1]} and ${numbers[i]}` });
              break;
            }
          }
        }

        if (errors.length > 0) {
          // 200, not 400 — same convention as puzzle/validate: this is an
          // application-level validation RESULT (which the client needs to
          // render in full, per-puzzle-per-row), not an HTTP-level request
          // error, so it must not be collapsed down to apiClient's single
          // ApiError message string.
          const { data: event } = await db.from("wl_events").select("unwordle_bank_size").eq("id", eventId).maybeSingle();
          return json(req, { accepted: [], errors, bankSize: event?.unwordle_bank_size ?? 25, bankedCount: 0 });
        }

        // Upsert by (event_id, puzzle_number) — a re-upload that collides
        // with already-authored puzzle numbers overwrites them, always
        // forced back to DRAFT regardless of prior status (an edit must
        // never silently stay PUBLISHED from a stale prior save).
        const records = normalized.map((p) => ({
          event_id: eventId,
          puzzle_number: p.puzzleNumber,
          solution_word: p.solutionWord,
          row_patterns: p.rowPatterns,
          status: "DRAFT" as const,
        }));

        const { data: upserted, error } = await db
          .from("wl_unwordle_puzzles")
          .upsert(records, { onConflict: "event_id,puzzle_number" })
          .select("*");
        if (error) return json(req, { error: error.message }, 400);

        await writeAuditEntry(db, {
          adminLabel: admin.nameLabel,
          eventId,
          actionType: "UNWORDLE_BANK_UPLOADED",
          targetType: "unwordle_puzzle",
          targetIds: (upserted ?? []).map((p) => p.id),
          metadata: { count: normalized.length },
        });

        const { data: event } = await db.from("wl_events").select("unwordle_bank_size").eq("id", eventId).maybeSingle();
        const { count: bankedCount } = await db.from("wl_unwordle_puzzles").select("id", { count: "exact", head: true }).eq("event_id", eventId);

        return json(req, {
          accepted: (upserted ?? []).map((p) => toBankPuzzleDto(p as BankPuzzleRow)),
          errors: [],
          bankSize: event?.unwordle_bank_size ?? 25,
          bankedCount: bankedCount ?? 0,
        });
      }

      if (action === "bank/publish" && req.method === "POST") {
        const { data: event } = await db.from("wl_events").select("unwordle_bank_size, unwordle_round_started_at").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);
        if (event.unwordle_round_started_at) return json(req, { error: "The bank is locked once the round has started" }, 400);

        const bankSize = event.unwordle_bank_size;
        const { count } = await db.from("wl_unwordle_puzzles").select("id", { count: "exact", head: true }).eq("event_id", eventId);
        if ((count ?? 0) !== bankSize) {
          return json(req, { error: `Bank only has ${count ?? 0}/${bankSize} puzzles — upload or author ${bankSize - (count ?? 0)} more before publishing` }, 400);
        }

        const { data: puzzleIds } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId);
        await db.from("wl_unwordle_puzzles").update({ status: "PUBLISHED" }).eq("event_id", eventId);
        await writeAuditEntry(db, {
          adminLabel: admin.nameLabel,
          eventId,
          actionType: "UNWORDLE_BANK_PUBLISHED",
          targetType: "unwordle_puzzle",
          targetIds: (puzzleIds ?? []).map((p) => p.id),
          metadata: { count: bankSize },
        });
        return json(req, { ok: true });
      }

      // Manual single-puzzle create/edit (top-up path alongside bulk upload).
      if (action === "puzzle" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const solutionWord = typeof body.solutionWord === "string" ? body.solutionWord.trim() : "";
        const rowPatterns = body.rowPatterns;
        if (solutionWord.length !== 5) return json(req, { error: "Solution word must be exactly 5 letters" }, 400);
        if (!isValidGuessWord(solutionWord)) return json(req, { error: "Solution word must be a real dictionary word" }, 400);
        if (!Array.isArray(rowPatterns) || rowPatterns.length !== ROWS_PER_PUZZLE || !rowPatterns.every(isValidPattern)) {
          return json(req, { error: `Exactly ${ROWS_PER_PUZZLE} row patterns of ${ROW_LENGTH} tiles each are required` }, 400);
        }

        const validation = validatePuzzlePatterns(solutionWord, rowPatterns, VALID_GUESS_WORDS);
        if (!validation.valid) {
          const badRows = validation.rowResults.filter((r) => !r.satisfiable).map((r) => r.rowIndex + 1);
          return json(req, { error: `Row(s) ${badRows.join(", ")} have no valid word satisfying that pattern` }, 400);
        }

        const { data: event } = await db.from("wl_events").select("unwordle_bank_size").eq("id", eventId).maybeSingle();
        const bankSize = event?.unwordle_bank_size ?? 25;

        let puzzleNumber = Number(body.puzzleNumber);
        if (!Number.isInteger(puzzleNumber) || puzzleNumber <= 0) {
          const { data: existingPuzzles } = await db
            .from("wl_unwordle_puzzles")
            .select("puzzle_number")
            .eq("event_id", eventId)
            .order("puzzle_number", { ascending: false })
            .limit(1);
          puzzleNumber = (existingPuzzles?.[0]?.puzzle_number ?? 0) + 1;
        }
        if (puzzleNumber > bankSize) {
          return json(req, { error: `Puzzle number ${puzzleNumber} exceeds this event's configured bank size of ${bankSize}` }, 400);
        }

        const { data: existing } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId).eq("puzzle_number", puzzleNumber).maybeSingle();

        const { data: puzzle, error } = existing
          ? await db
              .from("wl_unwordle_puzzles")
              .update({ solution_word: solutionWord.toUpperCase(), row_patterns: rowPatterns, status: "DRAFT" })
              .eq("id", existing.id)
              .select("*")
              .single()
          : await db
              .from("wl_unwordle_puzzles")
              .insert({ event_id: eventId, puzzle_number: puzzleNumber, solution_word: solutionWord.toUpperCase(), row_patterns: rowPatterns })
              .select("*")
              .single();
        if (error) return json(req, { error: error.message }, 400);

        await writeAuditEntry(db, {
          adminLabel: admin.nameLabel,
          eventId,
          actionType: existing ? "UNWORDLE_PUZZLE_UPDATED" : "UNWORDLE_PUZZLE_CREATED",
          targetType: "unwordle_puzzle",
          targetIds: [puzzle.id],
        });

        return json(req, { puzzle: toBankPuzzleDto(puzzle as BankPuzzleRow), validation }, existing ? 200 : 201);
      }

      if (action === "puzzle" && req.method === "GET") {
        const puzzleNumber = Number(url.searchParams.get("puzzleNumber") ?? "1");
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("*").eq("event_id", eventId).eq("puzzle_number", puzzleNumber).maybeSingle();
        if (!puzzle) return json(req, { error: "No puzzle at that number exists for this event yet" }, 404);
        return json(req, toBankPuzzleDto(puzzle as BankPuzzleRow));
      }

      if (action === "puzzle/validate" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (typeof body.solutionWord !== "string" || !Array.isArray(body.rowPatterns) || body.rowPatterns.length !== ROWS_PER_PUZZLE) {
          return json(req, { error: "solutionWord (5 letters) and 4 row patterns of 5 tiles each are required" }, 400);
        }
        return json(req, validatePuzzlePatterns(body.solutionWord, body.rowPatterns, VALID_GUESS_WORDS));
      }

      // ---- Round lifecycle ----

      if (action === "round/start" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const { data: event } = await db.from("wl_events").select("*").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);
        if (event.unwordle_round_started_at) return json(req, { error: "Round already started" }, 400);

        const bankSize = event.unwordle_bank_size;
        const { count: publishedCount } = await db
          .from("wl_unwordle_puzzles")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "PUBLISHED");
        if ((publishedCount ?? 0) !== bankSize) {
          return json(req, { error: `Bank only has ${publishedCount ?? 0}/${bankSize} puzzles published — publish the full bank before starting the round` }, 400);
        }

        const { data: bankPuzzles } = await db.from("wl_unwordle_puzzles").select("*").eq("event_id", eventId).order("puzzle_number");
        if (!bankPuzzles || bankPuzzles.length === 0) return json(req, { error: "Puzzle 1 not found in the bank" }, 400);
        const puzzleIds = bankPuzzles.map((p) => p.id);

        const { data: twPuzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!twPuzzle) return json(req, { error: "No Timed Wordle puzzle exists for this event yet" }, 400);
        const { data: advancedRows } = await db
          .from("wl_timed_wordle_sessions")
          .select("event_player_id")
          .eq("puzzle_id", twPuzzle.id)
          .eq("advanced_to_playoffs", true);
        const advancedIds = (advancedRows ?? []).map((r) => r.event_player_id);
        if (advancedIds.length === 0) return json(req, { error: "No players have been advanced to Playoffs yet" }, 400);

        // Idempotent retry safety — skip anyone who already has ANY session
        // in this event's bank (a retried/duplicate Start Round call must
        // not double-up).
        const { data: existingSessions } = await db.from("wl_unwordle_sessions").select("event_player_id").in("puzzle_id", puzzleIds);
        const alreadyStarted = new Set((existingSessions ?? []).map((r) => r.event_player_id));
        const toStart = advancedIds.filter((id) => !alreadyStarted.has(id));

        const now = Date.now();
        const nowIso = new Date(now).toISOString();

        if (toStart.length > 0) {
          // Every puzzle whose 4 rows are all freebie (all-Green) has
          // nothing for a player to actually do — it's born already
          // COMPLETED for everyone, and the round only really begins at the
          // first puzzle with real rows to solve. This is the bulk-path
          // equivalent of createAndStartSessionCascading, sized for
          // hundreds of players at once rather than looping per player.
          const skippedPuzzles: (typeof bankPuzzles)[number][] = [];
          let startPuzzle: (typeof bankPuzzles)[number] | null = null;
          for (const p of bankPuzzles) {
            const { freebieCount } = computeFreebieRows(p.row_patterns);
            if (freebieCount === p.row_patterns.length) {
              skippedPuzzles.push(p);
            } else {
              startPuzzle = p;
              break;
            }
          }

          for (const p of skippedPuzzles) {
            const { freebieRows, freebieCount } = computeFreebieRows(p.row_patterns);
            const { data: insertedSessions, error: sessionError } = await db
              .from("wl_unwordle_sessions")
              .insert(
                toStart.map((eventPlayerId) => ({
                  puzzle_id: p.id,
                  event_player_id: eventPlayerId,
                  status: "COMPLETED",
                  start_time: nowIso,
                  stop_time: nowIso,
                  rows_solved_count: freebieCount,
                }))
              )
              .select("id");
            if (sessionError) return json(req, { error: sessionError.message }, 400);

            const rowsToInsert = (insertedSessions ?? []).flatMap((s) =>
              Array.from({ length: ROWS_PER_PUZZLE }, (_, rowIndex) => ({
                session_id: s.id,
                row_index: rowIndex,
                solved: freebieRows[rowIndex],
                solved_word: freebieRows[rowIndex] ? p.solution_word : null,
              }))
            );
            if (rowsToInsert.length > 0) {
              const { error: rowsError } = await db.from("wl_unwordle_rows").insert(rowsToInsert);
              if (rowsError) return json(req, { error: rowsError.message }, 400);
            }
          }

          if (startPuzzle) {
            const { freebieRows, freebieCount } = computeFreebieRows(startPuzzle.row_patterns);
            const { data: insertedSessions, error: sessionError } = await db
              .from("wl_unwordle_sessions")
              .insert(
                toStart.map((eventPlayerId) => ({
                  puzzle_id: startPuzzle!.id,
                  event_player_id: eventPlayerId,
                  status: "IN_PROGRESS",
                  start_time: nowIso,
                  rows_solved_count: freebieCount,
                }))
              )
              .select("id");
            if (sessionError) return json(req, { error: sessionError.message }, 400);

            const rowsToInsert = (insertedSessions ?? []).flatMap((s) =>
              Array.from({ length: ROWS_PER_PUZZLE }, (_, rowIndex) => ({
                session_id: s.id,
                row_index: rowIndex,
                solved: freebieRows[rowIndex],
                solved_word: freebieRows[rowIndex] ? startPuzzle!.solution_word : null,
              }))
            );
            if (rowsToInsert.length > 0) {
              const { error: rowsError } = await db.from("wl_unwordle_rows").insert(rowsToInsert);
              if (rowsError) return json(req, { error: rowsError.message }, 400);
            }
          }
          // If every puzzle in the bank is fully-freebie (startPuzzle stays
          // null), toStart players simply end up with only COMPLETED
          // sessions and no active one — they'll correctly show as
          // BANK_EXHAUSTED the moment anything reads their status.
        }

        const roundDurationMs = typeof body.roundDurationMs === "number" && body.roundDurationMs > 0 ? body.roundDurationMs : event.unwordle_round_duration_ms;
        const roundEndsAtIso = new Date(now + roundDurationMs).toISOString();
        await db
          .from("wl_events")
          .update({
            unwordle_round_started_at: new Date(now).toISOString(),
            unwordle_round_ends_at: roundEndsAtIso,
            unwordle_round_duration_ms: roundDurationMs,
            status: "PLAYOFFS_LIVE",
          })
          .eq("id", eventId);

        await writeAuditEntry(db, {
          adminLabel: admin.nameLabel,
          eventId,
          actionType: "UNWORDLE_ROUND_STARTED",
          targetType: "event",
          targetIds: [eventId],
          metadata: { count: toStart.length, roundDurationMs },
        });

        return json(req, { ok: true, startedCount: toStart.length, roundEndsAt: roundEndsAtIso });
      }

      if (action === "round/end" && req.method === "POST") {
        const { data: event } = await db.from("wl_events").select("*").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);
        if (!event.unwordle_round_started_at) return json(req, { error: "Round has not started yet" }, 400);

        const now = Date.now();
        await db.from("wl_events").update({ unwordle_round_ends_at: new Date(now).toISOString(), status: "PLAYOFFS_CLOSED" }).eq("id", eventId);

        const { data: puzzles } = await db.from("wl_unwordle_puzzles").select("id").eq("event_id", eventId);
        const puzzleIds = (puzzles ?? []).map((p) => p.id);
        let count = 0;
        if (puzzleIds.length > 0) {
          const { data: sessions } = await db.from("wl_unwordle_sessions").select("id").in("puzzle_id", puzzleIds).eq("status", "IN_PROGRESS");
          for (const s of sessions ?? []) {
            const loaded = await loadSessionAndPuzzle(db, s.id);
            if (!loaded || loaded.state.status !== "IN_PROGRESS") continue;
            const ended = adminEndSession(loaded.state, now);
            const ok = await persistSession(db, s.id, loaded.sessionRow.row_version, ended);
            if (ok) count++;
          }
        }

        await writeAuditEntry(db, {
          adminLabel: admin.nameLabel,
          eventId,
          actionType: "UNWORDLE_ROUND_ENDED_MANUAL",
          targetType: "event",
          targetIds: [eventId],
          reason: "End Round Now",
          metadata: { count },
        });
        return json(req, { ok: true, count });
      }

      if (action === "round/resume" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const targetPlayerId = Number(body.eventPlayerId);
        if (!Number.isInteger(targetPlayerId) || targetPlayerId <= 0) return json(req, { error: "eventPlayerId is required" }, 400);

        const { data: event } = await db.from("wl_events").select("*").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);

        const now = Date.now();
        if (event.unwordle_round_ends_at && now >= new Date(event.unwordle_round_ends_at).getTime()) {
          return json(req, { error: "The round has already ended" }, 400);
        }

        const { data: puzzles } = await db.from("wl_unwordle_puzzles").select("id, puzzle_number").eq("event_id", eventId);
        const puzzleIds = (puzzles ?? []).map((p) => p.id);
        const puzzleNumberById = new Map((puzzles ?? []).map((p) => [p.id, p.puzzle_number]));

        const { data: sessions } = await db.from("wl_unwordle_sessions").select("*").in("puzzle_id", puzzleIds).eq("event_player_id", targetPlayerId);
        const withPuzzleNumber = (sessions ?? []).map((s) => ({ ...s, puzzleNumber: puzzleNumberById.get(s.puzzle_id) ?? 0 }));
        withPuzzleNumber.sort((a, b) => b.puzzleNumber - a.puzzleNumber);
        const latest = withPuzzleNumber[0];

        if (!latest || latest.status !== "EXITED") {
          return json(req, { error: "This player has no exited puzzle to resume" }, 400);
        }
        if (latest.puzzleNumber >= event.unwordle_bank_size) {
          return json(req, { error: "Already finished the whole bank — nothing to resume" }, 400);
        }

        const resumed = await createAndStartSessionCascading(db, eventId, latest.puzzleNumber + 1, event.unwordle_bank_size, targetPlayerId, now);
        if ("bankExhausted" in resumed) {
          return json(req, { error: "Every remaining puzzle was already fully solved — nothing left to resume into" }, 400);
        }
        await writeAuditEntry(db, {
          adminLabel: admin.nameLabel,
          eventId,
          actionType: "UNWORDLE_PLAYER_RESUMED",
          targetType: "event_player",
          targetIds: [targetPlayerId],
          metadata: { puzzleNumber: resumed.puzzleNumber },
        });
        return json(req, { ok: true, sessionId: resumed.sessionId, puzzleNumber: resumed.puzzleNumber });
      }

      if (action === "sessions" && req.method === "GET") {
        const { data: event } = await db.from("wl_events").select("unwordle_bank_size").eq("id", eventId).maybeSingle();
        const bankSize = event?.unwordle_bank_size ?? 25;
        const aggs = await loadAdvancedPlayersWithSessions(db, eventId);
        return json(req, aggs.map((a) => toMonitorEntry(a, bankSize)));
      }

      if (action === "leaderboard" && req.method === "GET") {
        return json(req, await getRoundLeaderboard(db, eventId));
      }

      return json(req, { error: "Not found" }, 404);
    }

    // ============================= PLAYER =============================
    if (audience === "player") {
      const player = await requirePlayer(req);
      const eventId = Number(rest[1]);
      if (!Number.isInteger(eventId) || eventId <= 0) return json(req, { error: "Invalid event id" }, 400);
      const action = rest.slice(2).join("/");

      if (action === "status" && req.method === "GET") {
        const { data: event } = await db.from("wl_events").select("*").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);

        const notAFinalist = {
          eventName: event.name,
          isFinalist: false,
          eventPlayerId: player.eventPlayerId,
          playerState: "NOT_A_FINALIST" as const,
          sessionId: null,
          sessionStatus: null,
          state: null,
          ended: null,
          puzzleNumber: null,
          bankSize: null,
          totalPoints: 0,
          totalPuzzlesCompleted: 0,
          roundStartedAt: null,
          roundEndsAt: null,
          bankExhausted: false,
          roundEnded: false,
        };

        const { data: twPuzzle } = await db.from("wl_timed_wordle_puzzles").select("id").eq("event_id", eventId).maybeSingle();
        if (!twPuzzle) return json(req, notAFinalist);
        const { data: myTwSession } = await db
          .from("wl_timed_wordle_sessions")
          .select("advanced_to_playoffs")
          .eq("puzzle_id", twPuzzle.id)
          .eq("event_player_id", player.eventPlayerId)
          .maybeSingle();
        if (!myTwSession?.advanced_to_playoffs) return json(req, notAFinalist);

        if (!event.unwordle_round_started_at) {
          return json(req, {
            ...notAFinalist,
            isFinalist: true,
            playerState: "AWAITING_ROUND_START" as const,
            bankSize: event.unwordle_bank_size,
          });
        }

        const now = Date.now();
        await reconcileRoundForPlayer(db, event, player.eventPlayerId, now);

        const roundStartedAtMs = event.unwordle_round_started_at ? new Date(event.unwordle_round_started_at).getTime() : null;
        const roundEndsAtMs = event.unwordle_round_ends_at ? new Date(event.unwordle_round_ends_at).getTime() : null;
        const roundEnded = roundEndsAtMs !== null && now >= roundEndsAtMs;

        const { data: puzzles } = await db.from("wl_unwordle_puzzles").select("id, puzzle_number").eq("event_id", eventId);
        const puzzleIds = (puzzles ?? []).map((p) => p.id);
        const puzzleNumberById = new Map((puzzles ?? []).map((p) => [p.id, p.puzzle_number]));

        const { data: mySessions } = await db.from("wl_unwordle_sessions").select("*").in("puzzle_id", puzzleIds).eq("event_player_id", player.eventPlayerId);
        const sessions = ((mySessions ?? []) as SessionRow[])
          .map((s) => ({ ...s, puzzleNumber: puzzleNumberById.get(s.puzzle_id) ?? 0 }))
          .sort((a, b) => a.puzzleNumber - b.puzzleNumber);

        const totalPoints = sessions.reduce((sum, s) => sum + s.rows_solved_count * 25, 0);
        const totalPuzzlesCompleted = sessions.filter((s) => s.status === "COMPLETED").length;

        if (sessions.length === 0) {
          // Advanced + round started, but never got a session — reachable
          // only for a latecomer advanced after Start Round already fired
          // (an accepted, low-probability edge case, not a bug).
          return json(req, {
            ...notAFinalist,
            isFinalist: true,
            playerState: "AWAITING_ROUND_START" as const,
            bankSize: event.unwordle_bank_size,
            roundStartedAt: roundStartedAtMs,
            roundEndsAt: roundEndsAtMs,
          });
        }

        const current = sessions[sessions.length - 1];
        const { data: puzzle } = await db.from("wl_unwordle_puzzles").select("*").eq("id", current.puzzle_id).maybeSingle<BankPuzzleRow>();
        const { data: rowRows } = await db.from("wl_unwordle_rows").select("*").eq("session_id", current.id).order("row_index");
        const state = hydrateSession(current, (rowRows ?? []) as RowRow[], puzzle!.solution_word, puzzle!.row_patterns);

        let playerState: "PLAYING" | "EXITED_AWAITING_RESUME" | "BANK_EXHAUSTED_WAITING" | "ROUND_ENDED";
        let ended = null;
        let stateDto = null;

        if (roundEnded) {
          playerState = "ROUND_ENDED";
          if (current.status !== "IN_PROGRESS") {
            ended = buildEndedPayload(current.id, current.status === "COMPLETED" ? "completed" : "admin_ended", state);
          }
        } else if (current.status === "IN_PROGRESS") {
          playerState = "PLAYING";
          stateDto = toStateDto(state);
        } else if (current.status === "EXITED") {
          playerState = "EXITED_AWAITING_RESUME";
        } else if (current.status === "COMPLETED" && current.puzzleNumber >= event.unwordle_bank_size) {
          playerState = "BANK_EXHAUSTED_WAITING";
        } else {
          playerState = "PLAYING";
          stateDto = toStateDto(state);
        }

        return json(req, {
          eventName: event.name,
          isFinalist: true,
          eventPlayerId: player.eventPlayerId,
          playerState,
          sessionId: current.id,
          sessionStatus: current.status,
          state: stateDto,
          ended,
          puzzleNumber: current.puzzleNumber,
          bankSize: event.unwordle_bank_size,
          totalPoints,
          totalPuzzlesCompleted,
          roundStartedAt: roundStartedAtMs,
          roundEndsAt: roundEndsAtMs,
          bankExhausted: playerState === "BANK_EXHAUSTED_WAITING",
          roundEnded,
        });
      }

      if (action === "leaderboard" && req.method === "GET") {
        return json(req, await getRoundLeaderboard(db, eventId));
      }

      if (action === "row/submit" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const rowIndex = Number(body.rowIndex);
        const guess = typeof body.guess === "string" ? body.guess : "";
        if (rowIndex < 0 || rowIndex >= ROWS_PER_PUZZLE) return json(req, { error: "Invalid row index" }, 400);

        const { data: event } = await db.from("wl_events").select("*").eq("id", eventId).maybeSingle();
        if (!event) return json(req, { error: "Event not found" }, 404);

        const now = Date.now();
        const roundEndsAtMs = event.unwordle_round_ends_at ? new Date(event.unwordle_round_ends_at).getTime() : null;
        const { forcedEnd } = await reconcileRoundForPlayer(db, event, player.eventPlayerId, now);
        if (forcedEnd) {
          const loaded = await loadSessionAndPuzzle(db, sessionId);
          return json(req, {
            outcome: { kind: "REJECTED_INVALID_WORD" },
            roundOutcome: "ROUND_ENDED",
            sessionId,
            state: null,
            puzzleNumber: loaded?.puzzle.puzzle_number ?? 0,
            bankSize: event.unwordle_bank_size,
            roundEndsAt: roundEndsAtMs,
          });
        }

        const loaded = await loadSessionAndPuzzle(db, sessionId);
        if (!loaded) return json(req, { error: "Session not found" }, 404);
        if (loaded.state.status !== "IN_PROGRESS") {
          return json(req, { error: "This session is no longer in progress" }, 409);
        }

        try {
          const { session, outcome } = submitWord(loaded.state, rowIndex, guess, now, isValidGuessWord);
          const ok = await persistSession(db, sessionId, loaded.sessionRow.row_version, session);
          if (!ok) return json(req, { error: "Could not persist guess — please retry" }, 409);

          const rowDbId = await persistRow(db, sessionId, session.rows[rowIndex]);
          await db.from("wl_unwordle_row_attempts").insert({
            row_id: rowDbId,
            guess_word: guess.toUpperCase(),
            is_valid_word: outcome.kind !== "REJECTED_INVALID_WORD",
            satisfies_tiles: outcome.kind === "ACCEPTED",
            failed_tile_reasons: outcome.kind === "REJECTED_TILE_MISMATCH" ? outcome.failedTiles : [],
          });

          const puzzleNumber = loaded.puzzle.puzzle_number;
          const bankSize = event.unwordle_bank_size;

          if (outcome.kind === "ACCEPTED" && outcome.puzzleCompleted) {
            if (puzzleNumber < bankSize) {
              // Cascades past any fully-freebie puzzle it lands on (nothing
              // to actually play there), landing on the next real puzzle or
              // exhausting the bank.
              const advanced = await createAndStartSessionCascading(db, eventId, puzzleNumber + 1, bankSize, player.eventPlayerId, Date.now());
              if ("bankExhausted" in advanced) {
                return json(req, { outcome, roundOutcome: "BANK_EXHAUSTED", sessionId, state: null, puzzleNumber, bankSize, roundEndsAt: roundEndsAtMs });
              }
              const nextLoaded = await loadSessionAndPuzzle(db, advanced.sessionId);
              return json(req, {
                outcome,
                roundOutcome: "ADVANCED",
                sessionId: advanced.sessionId,
                state: nextLoaded ? toStateDto(nextLoaded.state) : null,
                puzzleNumber: advanced.puzzleNumber,
                bankSize,
                roundEndsAt: roundEndsAtMs,
              });
            }
            return json(req, { outcome, roundOutcome: "BANK_EXHAUSTED", sessionId, state: null, puzzleNumber, bankSize, roundEndsAt: roundEndsAtMs });
          }

          return json(req, { outcome, roundOutcome: "CONTINUE", sessionId, state: toStateDto(session), puzzleNumber, bankSize, roundEndsAt: roundEndsAtMs });
        } catch (err) {
          return json(req, { error: err instanceof Error ? err.message : "Failed to submit guess" }, 400);
        }
      }

      if (action === "exit" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const sessionId = Number(body.sessionId);
        const loaded = await loadSessionAndPuzzle(db, sessionId);
        if (!loaded) return json(req, { error: "Session not found" }, 404);

        try {
          const exited = playerExitSession(loaded.state, Date.now());
          const ok = await persistSession(db, sessionId, loaded.sessionRow.row_version, exited);
          if (!ok) return json(req, { error: "Could not persist exit — please retry" }, 409);
          return json(req, { ok: true });
        } catch (err) {
          return json(req, { error: err instanceof Error ? err.message : "Failed to exit" }, 400);
        }
      }

      return json(req, { error: "Not found" }, 404);
    }

    return json(req, { error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json(req, { error: err.message }, err.status);
    console.error("wl-unwordle error", err);
    return json(req, { error: "Internal server error" }, 500);
  }
});
