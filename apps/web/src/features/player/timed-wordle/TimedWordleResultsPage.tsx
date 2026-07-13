import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import type { TimedWordleGameEndedPayload, TimedWordleRoundStatusDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { GameEndScreen } from "./GameEndScreen";

/** Reached when a player returns to a round they've already finished (e.g. closed
 * the tab and came back) — fetches the finished summary via REST rather than relying
 * on the live socket payload, which only exists for the duration of that session. */
export function TimedWordleResultsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [status, setStatus] = useState<TimedWordleRoundStatusDto | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiClient
      .get<TimedWordleRoundStatusDto>(`/player/events/${eventId}/timed-wordle/status`)
      .then(setStatus)
      .catch(() => setNotFound(true));
  }, [eventId]);

  if (notFound) return <Navigate to={`/play/${eventId}/lobby`} replace />;
  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }
  if (!status.result || status.sessionId === null) {
    return <Navigate to={`/play/${eventId}/lobby`} replace />;
  }

  const payload: TimedWordleGameEndedPayload = {
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
  };

  return <GameEndScreen result={payload} />;
}
