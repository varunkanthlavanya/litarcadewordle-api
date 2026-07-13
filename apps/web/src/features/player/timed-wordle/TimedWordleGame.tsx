import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  TileColor,
  TimedWordleGameEndedPayload,
  TimedWordleStateDto,
  TimedWordleTryDto,
} from "@litarcadewordle/shared-types";
import { getPlayerSocket, emitWithAck, waitForConnection } from "@/lib/socketClient";
import { WordGrid } from "./WordGrid";
import { Keyboard } from "./Keyboard";
import { TimerHud } from "./TimerHud";
import { GameEndScreen } from "./GameEndScreen";

const WORD_LENGTH = 5;
const COLOR_RANK: Record<TileColor, number> = { GRAY: 0, YELLOW: 1, GREEN: 2 };

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

  useEffect(() => {
    const socket = getPlayerSocket();
    let cancelled = false;

    waitForConnection(socket)
      .then(() =>
        emitWithAck<
          { eventId: number },
          { ok: boolean; error?: string; sessionId?: number; state?: TimedWordleStateDto }
        >(socket, "tw:game:start", { eventId: Number(eventId) })
      )
      .then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.ok || !res.state || res.sessionId === undefined) {
          setError(res.error ?? "Could not start the game");
          return;
        }
        setSessionId(res.sessionId);
        setState(res.state);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoading(false);
        setError(err.message);
      });

    function onTryAdvance(payload: { tryNumber: number; skipped: boolean; tryDeadlineAt: number; bankedMs: number }) {
      setState((prev) =>
        prev
          ? { ...prev, currentTryNumber: payload.tryNumber, currentTryDeadlineAt: payload.tryDeadlineAt, graceActive: false, graceDeadlineAt: null, bankedSurplusMs: payload.bankedMs }
          : prev
      );
      setCurrentGuess("");
    }

    function onGraceOpened(payload: { graceDeadlineAt: number }) {
      setState((prev) => (prev ? { ...prev, graceActive: true, graceDeadlineAt: payload.graceDeadlineAt } : prev));
    }

    function onGameEnded(payload: TimedWordleGameEndedPayload) {
      setGameEnded(payload);
    }

    socket.on("tw:try:advance", onTryAdvance);
    socket.on("tw:grace:opened", onGraceOpened);
    socket.on("tw:game:ended", onGameEnded);

    return () => {
      cancelled = true;
      socket.off("tw:try:advance", onTryAdvance);
      socket.off("tw:grace:opened", onGraceOpened);
      socket.off("tw:game:ended", onGameEnded);
    };
  }, [eventId]);

  const submitGuess = useCallback(async () => {
    if (!sessionId || currentGuess.length !== WORD_LENGTH) return;
    setError(null);
    const socket = getPlayerSocket();
    const res = await emitWithAck<
      { sessionId: number; guess: string },
      { ok: boolean; error?: string; state?: TimedWordleStateDto }
    >(socket, "tw:guess:submit", { sessionId, guess: currentGuess });

    if (!res.ok) {
      setError(res.error ?? "Could not submit guess");
      return;
    }
    if (res.state) setState(res.state);
    setCurrentGuess("");
  }, [sessionId, currentGuess]);

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
