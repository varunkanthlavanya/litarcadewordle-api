import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { TileColor, UnwordleRoundStatusDto, UnwordleRowDto, UnwordleStateDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Keyboard } from "@/components/shared/Keyboard";
import { formatHhMmSsFromElapsed, useStopwatch } from "@/hooks/useStopwatch";
import { UnwordleRow } from "./UnwordleRow";

const WORD_LENGTH = 5;
const COLOR_RANK: Record<TileColor, number> = { GRAY: 0, YELLOW: 1, GREEN: 2 };

const FAILED_TILE_MESSAGES: Record<string, string> = {
  WRONG_LETTER_AT_GREEN_SLOT: "Wrong letter for a green tile",
  YELLOW_LETTER_NOT_IN_SOLUTION: "That letter isn't in the solution",
  YELLOW_LETTER_IN_SAME_POSITION: "That letter can't go in that exact position",
  GRAY_LETTER_IS_IN_SOLUTION: "That letter is actually in the solution",
};

// Only used to notice an admin-initiated end mid-game (no per-try deadline
// exists here to schedule against, unlike Timed Wordle) — replaces the old
// "uw:session:ended" Socket.IO push.
const POLL_MS = 3000;

/** Unlike Timed Wordle, a tile's color here is a GIVEN clue, not something
 * revealed by a guess — so once a row is solved, its letters tell you the
 * color that letter earns wherever it appears (best color wins, same
 * merge rule as Timed Wordle's keyboard). This is what colors the on-screen
 * keyboard as rows get solved. */
function computeLetterStatus(rows: UnwordleRowDto[]): Record<string, TileColor | undefined> {
  const status: Record<string, TileColor | undefined> = {};
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

export function UnwordleGame() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<UnwordleStateDto | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
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

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`)
      .then((res) => {
        if (cancelled) return;
        if (res.sessionStatus !== "IN_PROGRESS" || !res.state || !res.sessionId) {
          navigate(`/play/${eventId}/dashboard`, { replace: true });
          return;
        }
        setSessionId(res.sessionId);
        setState(res.state);
        const firstUnsolved = res.state.rows.findIndex((r) => !r.solved);
        if (firstUnsolved >= 0) setSelectedRow(firstUnsolved);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });

    const interval = setInterval(() => {
      apiClient
        .get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`)
        .then((res) => {
          if (!cancelled && res.sessionStatus !== "IN_PROGRESS") {
            navigate(`/play/${eventId}/unwordle/results`, { replace: true });
          }
        })
        .catch(() => {});
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [eventId, navigate]);

  const elapsedMs = useStopwatch(state?.startTime ?? null);

  const selectedRowSolved = state?.rows[selectedRow]?.solved ?? false;

  function selectRow(rowIndex: number) {
    if (state?.rows[rowIndex]?.solved) return;
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
      const res = await apiClient.post<{
        outcome: { kind: string; failedTiles?: Array<{ reason: string }>; puzzleCompleted?: boolean };
        state: UnwordleStateDto;
      }>(`/player/events/${eventId}/unwordle/row/submit`, { sessionId, rowIndex: rowBeingSubmitted, guess });

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
      setState(res.state);
      setJustSolvedRow(rowBeingSubmitted);
      setTimeout(() => setJustSolvedRow(null), 1200);

      if (res.outcome.puzzleCompleted) {
        navigate(`/play/${eventId}/unwordle/results`, { replace: true });
        return;
      }

      const nextUnsolved = res.state.rows.findIndex((r) => !r.solved);
      if (nextUnsolved >= 0) setSelectedRow(nextUnsolved);
    } catch (err) {
      setRejection(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, currentGuess, selectedRowSolved, submitting, selectedRow, eventId, navigate]);

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

  const letterStatus = useMemo(() => computeLetterStatus(state?.rows ?? []), [state?.rows]);

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
        <h1 className="text-base font-bold">UNWORDLE</h1>
        <div className="text-right">
          <p className="font-mono text-xl font-bold tabular-nums">{formatHhMmSsFromElapsed(elapsedMs)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">elapsed</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2">
        <div className="flex flex-col gap-2">
          {state.rows.map((row, i) => (
            <UnwordleRow
              key={i}
              row={row}
              selected={i === selectedRow}
              onSelect={() => selectRow(i)}
              currentGuess={i === selectedRow && !row.solved ? currentGuess : undefined}
              justSolved={i === justSolvedRow}
              shake={i === shakeRow}
            />
          ))}
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
