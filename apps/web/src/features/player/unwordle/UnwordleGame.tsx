import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  TileColor,
  UnwordleRoundOutcome,
  UnwordleRoundStatusDto,
  UnwordleRowDto,
  UnwordleRowSubmitResponse,
  UnwordleStateDto,
} from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Keyboard } from "@/components/shared/Keyboard";
import { formatHhMmSsFromElapsed, useStopwatch } from "@/hooks/useStopwatch";
import { useCountdown, formatMmSs } from "@/hooks/useCountdown";
import { UnwordleRow } from "./UnwordleRow";
import { UnwordleTargetRow } from "./UnwordleTargetRow";

const WORD_LENGTH = 5;
const COLOR_RANK: Record<TileColor, number> = { GRAY: 0, YELLOW: 1, GREEN: 2 };

const FAILED_TILE_MESSAGES: Record<string, string> = {
  WRONG_LETTER_AT_GREEN_SLOT: "Wrong letter for a green tile",
  YELLOW_LETTER_NOT_IN_SOLUTION: "That letter isn't in the solution",
  YELLOW_LETTER_IN_SAME_POSITION: "That letter can't go in that exact position",
  GRAY_LETTER_IS_IN_SOLUTION: "That letter is actually in the solution",
};

// Deadlines are enforced server-side on every call anyway (row/submit and
// status both reconcile the round deadline before responding) — this is
// just how promptly the client notices a transition it didn't cause itself
// (the round auto-ending, or an admin's early "End Round Now"), same
// event-driven-timer + sparse-heartbeat pattern already proven for Timed
// Wordle. A little slop past the exact deadline is fine.
const RECONCILE_BUFFER_MS = 250;
const HEARTBEAT_MS = 15_000;

/** Unlike Timed Wordle, a tile's color here is a GIVEN clue, not something
 * revealed by a guess — so once a row is solved, its letters tell you the
 * color that letter earns wherever it appears (best color wins, same
 * merge rule as Timed Wordle's keyboard). This is what colors the on-screen
 * keyboard as rows get solved. The solution word's own letters are seeded
 * in as GREEN up front, since the answer row already shows them — nothing
 * can ever downgrade a GREEN, so this is purely additive. */
function computeLetterStatus(rows: UnwordleRowDto[], solutionWord: string): Record<string, TileColor | undefined> {
  const status: Record<string, TileColor | undefined> = {};
  for (const letter of solutionWord) {
    status[letter] = "GREEN";
  }
  for (const row of rows) {
    if (!row.solved || !row.solvedWord) continue;
    for (let i = 0; i < row.solvedWord.length; i++) {
      const letter = row.solvedWord[i];
      const color = row.pattern[i];
      if (!status[letter] || COLOR_RANK[color] > COLOR_RANK[status[letter]!]) {
        status[letter] = color;
      }
    }
  }
  return status;
}

// Where a player who isn't currently mid-puzzle belongs — the results
// screen doubles as the round summary for every "not playing right now"
// reason (bank exhausted, exited awaiting resume, round ended); anything
// before the round has even started for them belongs back on the dashboard.
function notPlayingDestination(eventId: string | undefined, playerState: UnwordleRoundStatusDto["playerState"]): string {
  const path = playerState === "EXITED_AWAITING_RESUME" || playerState === "BANK_EXHAUSTED_WAITING" || playerState === "ROUND_ENDED"
    ? "unwordle/results"
    : "dashboard";
  return `/play/${eventId}/${path}`;
}

export function UnwordleGame() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<UnwordleStateDto | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState<number | null>(null);
  const [bankSize, setBankSize] = useState<number | null>(null);
  const [roundEndsAt, setRoundEndsAt] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState(0);
  const [currentGuess, setCurrentGuess] = useState("");
  const [rejection, setRejection] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which row (if any) should play its "just solved" reveal / "just
  // rejected" shake right now — set at the exact moment we know the outcome
  // (rather than diffed from render state), and cleared once the animation
  // has had time to finish so it doesn't replay on later, unrelated re-renders.
  const [justSolvedRow, setJustSolvedRow] = useState<number | null>(null);
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReconcile = useCallback((endsAt: number | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (endsAt === null) return;
    const delay = Math.max(endsAt - Date.now(), 0) + RECONCILE_BUFFER_MS;
    timerRef.current = setTimeout(() => void fetchStatus(), Math.min(delay, HEARTBEAT_MS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await apiClient.get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`);
      if (res.playerState !== "PLAYING" || !res.state || !res.sessionId) {
        if (timerRef.current) clearTimeout(timerRef.current);
        navigate(notPlayingDestination(eventId, res.playerState), { replace: true });
        return;
      }
      setSessionId(res.sessionId);
      setState(res.state);
      setPuzzleNumber(res.puzzleNumber);
      setBankSize(res.bankSize);
      setRoundEndsAt(res.roundEndsAt);
      scheduleReconcile(res.roundEndsAt);
    } catch {
      // Transient network hiccup on a background reconcile — the next
      // scheduled tick (or the player's own next action) will retry.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, navigate, scheduleReconcile]);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`)
      .then((res) => {
        if (cancelled) return;
        if (res.playerState !== "PLAYING" || !res.state || !res.sessionId) {
          navigate(notPlayingDestination(eventId, res.playerState), { replace: true });
          return;
        }
        setSessionId(res.sessionId);
        setState(res.state);
        setPuzzleNumber(res.puzzleNumber);
        setBankSize(res.bankSize);
        setRoundEndsAt(res.roundEndsAt);
        const firstUnsolved = res.state.rows.find((r) => !r.solved);
        if (firstUnsolved) setSelectedRow(firstUnsolved.rowIndex);
        scheduleReconcile(res.roundEndsAt);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, navigate]);

  const elapsedMs = useStopwatch(state?.startTime ?? null);
  const remainingMs = useCountdown(roundEndsAt);

  const selectedRowSolved = state?.rows.find((r) => r.rowIndex === selectedRow)?.solved ?? false;

  function selectRow(rowIndex: number) {
    if (state?.rows.find((r) => r.rowIndex === rowIndex)?.solved) return;
    setSelectedRow(rowIndex);
    setCurrentGuess("");
    setRejection(null);
  }

  const handleKey = useCallback((key: string) => {
    setCurrentGuess((g) => (g.length < WORD_LENGTH ? g + key : g));
  }, []);

  const handleBackspace = useCallback(() => {
    setCurrentGuess((g) => g.slice(0, -1));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!sessionId || currentGuess.length !== WORD_LENGTH || selectedRowSolved || submitting) return;
    const rowBeingSubmitted = selectedRow;
    const guess = currentGuess;
    setSubmitting(true);
    setRejection(null);
    try {
      const res = await apiClient.post<UnwordleRowSubmitResponse>(`/player/events/${eventId}/unwordle/row/submit`, {
        sessionId,
        rowIndex: rowBeingSubmitted,
        guess,
      });

      if (res.outcome.kind === "REJECTED_INVALID_WORD") {
        setRejection("Not a valid word — try again");
        setShakeRow(rowBeingSubmitted);
        setTimeout(() => setShakeRow(null), 400);
        return;
      }
      if (res.outcome.kind === "REJECTED_TILE_MISMATCH") {
        const reason = res.outcome.failedTiles?.[0]?.reason;
        setRejection(reason ? FAILED_TILE_MESSAGES[reason] ?? "Doesn't match this row's pattern" : "Doesn't match this row's pattern");
        setShakeRow(rowBeingSubmitted);
        setTimeout(() => setShakeRow(null), 400);
        return;
      }

      // ACCEPTED
      setCurrentGuess("");
      setJustSolvedRow(rowBeingSubmitted);
      setTimeout(() => setJustSolvedRow(null), 1200);

      const roundOutcome: UnwordleRoundOutcome = res.roundOutcome;
      if (roundOutcome === "ROUND_ENDED") {
        navigate(`/play/${eventId}/unwordle/results`, { replace: true });
        return;
      }
      if (roundOutcome === "BANK_EXHAUSTED") {
        navigate(`/play/${eventId}/unwordle/results`, { replace: true });
        return;
      }
      if (roundOutcome === "ADVANCED" && res.state) {
        // Seamless auto-advance to the next puzzle — no click, no
        // navigation, just fresh state swapped in (PRD §6 step 2).
        setSessionId(res.sessionId);
        setState(res.state);
        setPuzzleNumber(res.puzzleNumber);
        setRoundEndsAt(res.roundEndsAt);
        const firstUnsolved = res.state.rows.find((r) => !r.solved);
        setSelectedRow(firstUnsolved ? firstUnsolved.rowIndex : 0);
        scheduleReconcile(res.roundEndsAt);
        return;
      }

      // CONTINUE
      if (res.state) {
        setState(res.state);
        const nextUnsolved = res.state.rows.find((r) => !r.solved);
        if (nextUnsolved) setSelectedRow(nextUnsolved.rowIndex);
      }
    } catch (err) {
      setRejection(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, currentGuess, selectedRowSolved, submitting, selectedRow, eventId, navigate, scheduleReconcile]);

  // Physical/hardware keyboard support (desktop) — the on-screen Keyboard
  // below is the primary input on mobile, deliberately with no native
  // <input> anywhere on this screen so the device keyboard never pops up.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (selectedRowSolved) return;
      if (e.key === "Enter") {
        void handleSubmit();
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        handleKey(e.key.toUpperCase());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedRowSolved, handleSubmit, handleBackspace, handleKey]);

  const letterStatus = useMemo(
    () => computeLetterStatus(state?.rows ?? [], state?.solutionWord ?? ""),
    [state?.rows, state?.solutionWord]
  );

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-screen max-w-md flex-col gap-2 overflow-hidden p-3">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">UNWORDLE</h1>
          {puzzleNumber !== null && bankSize !== null && (
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Puzzle {puzzleNumber} / {bankSize}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-mono text-xl font-bold tabular-nums">{formatHhMmSsFromElapsed(elapsedMs)}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">elapsed</p>
          </div>
          {roundEndsAt !== null && (
            <div className="text-right">
              <p className="font-mono text-xl font-bold tabular-nums text-primary">{formatMmSs(remainingMs)}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">round ends in</p>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2">
        <div className="flex flex-col gap-2">
          {state.rows.map((row) => (
            <UnwordleRow
              key={row.rowIndex}
              row={row}
              selected={row.rowIndex === selectedRow}
              onSelect={() => selectRow(row.rowIndex)}
              currentGuess={row.rowIndex === selectedRow && !row.solved ? currentGuess : undefined}
              justSolved={row.rowIndex === justSolvedRow}
              shake={row.rowIndex === shakeRow}
            />
          ))}
          <UnwordleTargetRow solutionWord={state.solutionWord} />
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          {!selectedRowSolved && (
            <p className="text-xs text-muted-foreground">Row {selectedRow + 1} · type a 5-letter word matching this pattern</p>
          )}
          {rejection && (
            <p className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-background">
              {rejection}
            </p>
          )}
          {submitting && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checking...</p>}
        </div>
      </div>

      <Keyboard
        onKey={handleKey}
        onEnter={() => void handleSubmit()}
        onBackspace={handleBackspace}
        disabled={selectedRowSolved || submitting}
        letterStatus={letterStatus}
      />

      <p className="text-center text-xs text-muted-foreground">Tap any row to work it — any order.</p>
    </div>
  );
}
