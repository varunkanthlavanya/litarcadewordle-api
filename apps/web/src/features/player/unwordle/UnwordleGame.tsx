import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { UnwordleRoundStatusDto, UnwordleStateDto } from "@litarcadewordle/shared-types";
import { emitWithAck, getPlayerSocket, waitForConnection } from "@/lib/socketClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatHhMmSsFromElapsed, useStopwatch } from "@/hooks/useStopwatch";
import { UnwordleRow } from "./UnwordleRow";

const FAILED_TILE_MESSAGES: Record<string, string> = {
  WRONG_LETTER_AT_GREEN_SLOT: "Wrong letter for a green tile",
  YELLOW_LETTER_NOT_IN_SOLUTION: "That letter isn't in the solution",
  YELLOW_LETTER_IN_SAME_POSITION: "That letter can't go in that exact position",
  GRAY_LETTER_IS_IN_SOLUTION: "That letter is actually in the solution",
};

export function UnwordleGame() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<UnwordleStateDto | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState(0);
  const [guess, setGuess] = useState("");
  const [rejection, setRejection] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const socket = getPlayerSocket();

    function onEnded() {
      navigate(`/play/${eventId}/unwordle/results`, { replace: true });
    }
    socket.on("uw:session:ended", onEnded);

    waitForConnection(socket)
      .then(() =>
        emitWithAck<{ eventId: number }, { ok: boolean; error?: string; status?: UnwordleRoundStatusDto }>(
          socket,
          "uw:game:join",
          { eventId: Number(eventId) }
        )
      )
      .then((res) => {
        if (!res.ok || !res.status) {
          setLoadError(res.error ?? "Could not load the game");
          return;
        }
        if (res.status.sessionStatus !== "IN_PROGRESS" || !res.status.state || !res.status.sessionId) {
          navigate(`/play/${eventId}/unwordle/lobby`, { replace: true });
          return;
        }
        setSessionId(res.status.sessionId);
        setState(res.status.state);
        const firstUnsolved = res.status.state.rows.findIndex((r) => !r.solved);
        if (firstUnsolved >= 0) setSelectedRow(firstUnsolved);
      })
      .catch((err: Error) => setLoadError(err.message));

    return () => {
      socket.off("uw:session:ended", onEnded);
    };
  }, [eventId, navigate]);

  const elapsedMs = useStopwatch(state?.startTime ?? null);

  const selectedRowSolved = state?.rows[selectedRow]?.solved ?? false;

  async function handleSubmit() {
    if (!sessionId || guess.length !== 5 || selectedRowSolved) return;
    setSubmitting(true);
    setRejection(null);
    try {
      const socket = getPlayerSocket();
      const res = await emitWithAck<
        { eventId: number; sessionId: number; rowIndex: number; guess: string },
        { ok: boolean; error?: string; outcome?: { kind: string; failedTiles?: Array<{ reason: string }>; puzzleCompleted?: boolean } }
      >(socket, "uw:row:submit", { eventId: Number(eventId), sessionId, rowIndex: selectedRow, guess });

      if (!res.ok || !res.outcome) {
        setRejection(res.error ?? "Could not submit");
        return;
      }

      if (res.outcome.kind === "REJECTED_INVALID_WORD") {
        setRejection("Not a valid word — try again");
        return;
      }
      if (res.outcome.kind === "REJECTED_TILE_MISMATCH") {
        const reason = res.outcome.failedTiles?.[0]?.reason;
        setRejection(reason ? FAILED_TILE_MESSAGES[reason] ?? "Doesn't match this row's pattern" : "Doesn't match this row's pattern");
        return;
      }

      // ACCEPTED
      setGuess("");
      if (!state) return;
      const rows = state.rows.map((r, i) =>
        i === selectedRow ? { ...r, solved: true, solvedWord: guess.toUpperCase() } : r
      );
      setState({ ...state, rows, rowsSolvedCount: rows.filter((r) => r.solved).length });

      if (res.outcome.puzzleCompleted) {
        navigate(`/play/${eventId}/unwordle/results`, { replace: true });
        return;
      }

      const nextUnsolved = rows.findIndex((r) => !r.solved);
      if (nextUnsolved >= 0) setSelectedRow(nextUnsolved);
    } finally {
      setSubmitting(false);
    }
  }

  const instruction = useMemo(() => `Row ${selectedRow + 1} · enter a 5-letter word matching this pattern`, [selectedRow]);

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
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-bold">UNWORDLE</h1>
        <div className="text-right">
          <p className="font-mono text-xl font-bold tabular-nums">{formatHhMmSsFromElapsed(elapsedMs)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">elapsed</p>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {state.rows.map((row, i) => (
          <UnwordleRow key={i} row={row} selected={i === selectedRow} onSelect={() => !row.solved && setSelectedRow(i)} />
        ))}
      </div>

      {!selectedRowSolved && (
        <div className="mt-auto space-y-2">
          <p className="text-xs text-muted-foreground">{instruction}</p>
          <div className="flex gap-2">
            <Input
              value={guess}
              onChange={(e) => setGuess(e.target.value.toUpperCase().slice(0, 5))}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="_ _ _ _ _"
              className="font-mono tracking-[0.3em]"
              maxLength={5}
              autoCapitalize="characters"
            />
            <Button onClick={handleSubmit} disabled={submitting || guess.length !== 5}>
              Submit
            </Button>
          </div>
          {rejection && <p className="text-sm text-destructive">{rejection}</p>}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Tap any row to work it — any order. No deadline is ever shown, only the count-up.
      </p>
    </div>
  );
}
