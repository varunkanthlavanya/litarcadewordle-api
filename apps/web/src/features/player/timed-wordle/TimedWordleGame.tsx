import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  TileColor,
  TimedWordleGameEndedPayload,
  TimedWordleRoundStatusDto,
  TimedWordleStateDto,
  TimedWordleTryDto,
} from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { WordGrid } from "./WordGrid";
import { Keyboard } from "@/components/shared/Keyboard";
import { TimerHud } from "./TimerHud";
import { GameEndScreen } from "./GameEndScreen";

const WORD_LENGTH = 5;
const COLOR_RANK: Record<TileColor, number> = { GRAY: 0, YELLOW: 1, GREEN: 2 };
// Deadlines are enforced server-side on every call anyway (see wl-timed-wordle's
// lazy reconcile) — this is just how promptly the client notices a transition
// it didn't cause itself (grace opening, a skip, global timeout), replacing
// the old Socket.IO push. A little slop past the exact deadline is fine.
const RECONCILE_BUFFER_MS = 250;
const HEARTBEAT_MS = 15_000;

function computeLetterStatus(tries: TimedWordleTryDto[]): Record<string, TileColor | undefined> {
  const status: Record<string, TileColor | undefined> = {};
  for (const t of tries) {
    if (!t.feedback || !t.guess) continue;
    for (let i = 0; i < t.guess.length; i++) {
      const letter = t.guess[i];
      const color = t.feedback[i];
      if (!status[letter] || COLOR_RANK[color] > COLOR_RANK[status[letter]!]) {
        status[letter] = color;
      }
    }
  }
  return status;
}

export function TimedWordleGame() {
  const { eventId } = useParams<{ eventId: string }>();
  const [state, setState] = useState<TimedWordleStateDto | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [currentGuess, setCurrentGuess] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  // Separate from submittingRef below — this one drives visible UI (disabling
  // the keyboard, a "Checking..." indicator) so the player can tell their
  // guess is actually being validated over the network, not just silently
  // doing nothing until the reveal animation starts.
  const [submitting, setSubmitting] = useState(false);
  const [gameEnded, setGameEnded] = useState<TimedWordleGameEndedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a guess going out twice — e.g. a user pressing physical
  // Enter and clicking the on-screen Enter button in quick succession — since
  // that's the one action here with a real server side-effect if duplicated.
  const submittingRef = useRef(false);

  // Refs mirroring the latest render's values, read from the single stable
  // keydown listener further down — this is the standard fix for "listener
  // needs fresh state but shouldn't be torn down and rebuilt on every
  // keystroke" (which is exactly what was happening before: submitGuess used
  // to close over `currentGuess` directly, so its identity changed on every
  // keystroke, which re-subscribed the window listener on every keystroke).
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const currentGuessRef = useRef(currentGuess);
  currentGuessRef.current = currentGuess;
  const gameEndedRef = useRef(gameEnded);
  gameEndedRef.current = gameEnded;
  const isGameOverRef = useRef(false);
  isGameOverRef.current = state?.status !== "IN_PROGRESS";
  // Tracks which try the in-progress row belongs to, so the background
  // reconcile heartbeat (fires every ~15s, or sooner at a real timer
  // transition — see scheduleReconcile) can tell "nothing actually changed,
  // leave what the player is typing alone" apart from "a new try genuinely
  // started, clear the row". Without this, every heartbeat poll wiped
  // whatever letters were mid-entry, which is what looked like the word
  // "getting duplicated" — a keystroke lands right after a heartbeat clears
  // the guess, so the row appears to reset/jumble mid-type.
  const currentTryNumberRef = useRef<number | null>(null);

  const scheduleReconcile = useCallback((s: TimedWordleStateDto) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (s.status !== "IN_PROGRESS") return;
    const nextTransitionAt = s.graceActive && s.graceDeadlineAt !== null ? s.graceDeadlineAt : s.currentTryDeadlineAt;
    const target = Math.min(nextTransitionAt, s.globalDeadlineAt);
    const delay = Math.max(target - Date.now(), 0) + RECONCILE_BUFFER_MS;
    timerRef.current = setTimeout(() => void fetchFresh(), Math.min(delay, HEARTBEAT_MS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEndedDetails = useCallback(async () => {
    if (!eventId) return;
    try {
      const status = await apiClient.get<TimedWordleRoundStatusDto>(`/player/events/${eventId}/timed-wordle/status`);
      if (status.result && status.sessionId !== null) {
        setGameEnded({
          sessionId: status.sessionId,
          reason: status.result.reason,
          secretWord: status.result.secretWord,
          definition: status.result.definition,
          roundStatus: status.roundStatus,
          summary: {
            found: status.result.found,
            cumulativeTimeMs: status.result.cumulativeTimeMs,
            triesUsed: status.result.triesUsed,
            tileScore: status.result.tileScore,
          },
        });
      }
    } catch {
      // best-effort — the in-game state already reflects the terminal status either way
    }
  }, [eventId]);

  const fetchFresh = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await apiClient.post<{ sessionId: number; state: TimedWordleStateDto }>(
        `/player/events/${eventId}/timed-wordle/game/start`,
        {}
      );
      setLoading(false);
      setSessionId(res.sessionId);
      setState(res.state);
      if (currentTryNumberRef.current !== res.state.currentTryNumber) {
        currentTryNumberRef.current = res.state.currentTryNumber;
        setCurrentGuess("");
      }
      if (res.state.status !== "IN_PROGRESS") {
        void loadEndedDetails();
      } else {
        scheduleReconcile(res.state);
      }
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Could not start the game");
    }
  }, [eventId, loadEndedDetails, scheduleReconcile]);

  useEffect(() => {
    void fetchFresh();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const shakeRow = useCallback((message: string) => {
    setHint(message);
    setShake(true);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      setShake(false);
      setHint(null);
    }, 1200);
  }, []);

  const submitGuess = useCallback(async () => {
    if (submittingRef.current) return;
    // Read the live values via refs (see below) rather than closing over
    // `sessionId`/`currentGuess` directly, since this function is called from
    // a keydown listener that's registered exactly once on mount.
    const activeSessionId = sessionIdRef.current;
    const guess = currentGuessRef.current;
    if (!activeSessionId) return;
    // Same feedback real Wordle gives for pressing Enter too early — shake
    // the row and say so, rather than silently doing nothing.
    if (guess.length !== WORD_LENGTH) {
      shakeRow("Not enough letters");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setHint(null);
    try {
      const res = await apiClient.post<{ feedback: TileColor[]; state: TimedWordleStateDto }>(
        `/player/events/${eventId}/timed-wordle/game/guess`,
        { sessionId: activeSessionId, guess }
      );
      setState(res.state);
      currentTryNumberRef.current = res.state.currentTryNumber;
      setCurrentGuess("");
      if (res.state.status !== "IN_PROGRESS") {
        void loadEndedDetails();
      } else {
        scheduleReconcile(res.state);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not submit guess";
      // Same treatment as "Not enough letters" — a shake + hint the player
      // can immediately act on (retype), not a persistent error banner for
      // something that isn't really an error, just an invalid attempt.
      if (message === "Not in word list") {
        shakeRow(message);
      } else {
        setError(message);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, loadEndedDetails, scheduleReconcile, shakeRow]);

  const handleKey = useCallback((key: string) => {
    setCurrentGuess((g) => (g.length < WORD_LENGTH ? g + key : g));
  }, []);

  const handleBackspace = useCallback(() => {
    setCurrentGuess((g) => g.slice(0, -1));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (gameEndedRef.current || isGameOverRef.current) return;
      if (e.key === "Enter") {
        void submitGuess();
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        handleKey(e.key.toUpperCase());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submitGuess, handleBackspace, handleKey]);

  const letterStatus = useMemo(() => computeLetterStatus(state?.tries ?? []), [state?.tries]);

  if (gameEnded) return <GameEndScreen result={gameEnded} />;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading game...</p>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!state) return null;

  const isGameOver = state.status !== "IN_PROGRESS";

  return (
    <div className="mx-auto flex h-screen max-w-md flex-col gap-2 overflow-hidden p-3">
      <TimerHud
        globalDeadlineAt={state.globalDeadlineAt}
        currentTryNumber={state.currentTryNumber}
        graceActive={state.graceActive}
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
        {hint && (
          <p className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-background">
            {hint}
          </p>
        )}
        {submitting && (
          <p className="animate-presence-pulse text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Checking...
          </p>
        )}
        <WordGrid
          tries={state.tries}
          currentGuess={isGameOver ? "" : currentGuess}
          shakeCurrentRow={shake}
          found={state.status === "FOUND"}
        />
      </div>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <Keyboard
        onKey={handleKey}
        onEnter={() => void submitGuess()}
        onBackspace={handleBackspace}
        disabled={isGameOver || submitting}
        letterStatus={letterStatus}
      />
    </div>
  );
}
