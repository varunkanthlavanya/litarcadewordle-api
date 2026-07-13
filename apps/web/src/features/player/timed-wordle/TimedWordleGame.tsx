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
import { Keyboard } from "./Keyboard";
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
  const [gameEnded, setGameEnded] = useState<TimedWordleGameEndedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReconcile = useCallback((s: TimedWordleStateDto) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (s.status !== "IN_PROGRESS") return;
    const nextTransitionAt = s.graceActive && s.graceDeadlineAt !== null ? s.graceDeadlineAt : s.currentTryDeadlineAt;
    const target = Math.min(nextTransitionAt, s.globalDeadlineAt);
    const delay = Math.max(target - Date.now(), 0) + RECONCILE_BUFFER_MS;
    timerRef.current = setTimeout(() => void fetchFresh(), Math.min(delay, HEARTBEAT_MS));
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
      setCurrentGuess("");
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const submitGuess = useCallback(async () => {
    if (!sessionId || currentGuess.length !== WORD_LENGTH) return;
    setError(null);
    try {
      const res = await apiClient.post<{ feedback: TileColor[]; state: TimedWordleStateDto }>(
        `/player/events/${eventId}/timed-wordle/game/guess`,
        { sessionId, guess: currentGuess }
      );
      setState(res.state);
      setCurrentGuess("");
      if (res.state.status !== "IN_PROGRESS") {
        void loadEndedDetails();
      } else {
        scheduleReconcile(res.state);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit guess");
    }
  }, [sessionId, currentGuess, eventId, loadEndedDetails, scheduleReconcile]);

  const handleKey = useCallback((key: string) => {
    setCurrentGuess((g) => (g.length < WORD_LENGTH ? g + key : g));
  }, []);

  const handleBackspace = useCallback(() => {
    setCurrentGuess((g) => g.slice(0, -1));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (gameEnded) return;
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
  }, [gameEnded, submitGuess, handleBackspace, handleKey]);

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
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <TimerHud
        globalDeadlineAt={state.globalDeadlineAt}
        currentTryNumber={state.currentTryNumber}
        graceActive={state.graceActive}
      />
      <div className="flex flex-1 items-center justify-center">
        <WordGrid tries={state.tries} currentGuess={isGameOver ? "" : currentGuess} />
      </div>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <Keyboard
        onKey={handleKey}
        onEnter={() => void submitGuess()}
        onBackspace={handleBackspace}
        disabled={isGameOver}
        letterStatus={letterStatus}
      />
    </div>
  );
}
