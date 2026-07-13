import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { TimedWordleRoundStatusDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatHhMmSs, useCountdown } from "@/hooks/useCountdown";

const POLL_INTERVAL_MS = 10_000;

export function WaitingLobby() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<TimedWordleRoundStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await apiClient.get<TimedWordleRoundStatusDto>(
          `/player/events/${eventId}/timed-wordle/status`
        );
        if (!cancelled) setStatus(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load round status");
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [eventId]);

  useEffect(() => {
    if (!status) return;
    if (status.result) {
      navigate(`/play/${eventId}/results`, { replace: true });
    } else if (status.sessionStatus === "IN_PROGRESS") {
      navigate(`/play/${eventId}/game`, { replace: true });
    }
  }, [status, eventId, navigate]);

  const opensAtMs = status?.roundOpensAt ? new Date(status.roundOpensAt).getTime() : null;
  const remainingMs = useCountdown(opensAtMs);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const missedWindow = status.roundStatus === "CLOSED" && !status.result;
  const roundOpen = status.roundStatus === "OPEN";
  const showCountdown = status.roundStatus === "SCHEDULED" && opensAtMs !== null && remainingMs > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background px-5 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold">{status.eventName}</h1>
        <StatusBadge status="prelimsScheduled" label="Prelims" />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        {missedWindow ? (
          <p className="text-sm text-muted-foreground">You missed this round's window.</p>
        ) : showCountdown ? (
          <>
            <p className="font-mono text-4xl font-bold tabular-nums">{formatHhMmSs(remainingMs)}</p>
            <p className="text-sm text-muted-foreground">until Prelims opens</p>
            {status.roundOpensAt && (
              <p className="text-xs text-muted-foreground">
                Opens at {new Date(status.roundOpensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {roundOpen ? "The round is open — start when you're ready." : "Waiting for the round to open."}
          </p>
        )}
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={!roundOpen}
        onClick={() => navigate(`/play/${eventId}/game`)}
      >
        {roundOpen ? "Start" : "Waiting for round to open"}
      </Button>
    </div>
  );
}
