import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/apiClient";
import { formatMmSs } from "@/hooks/useCountdown";
import { cn } from "@/lib/utils";
import type { TimedWordleGameEndedPayload, TimedWordleLeaderboardEntry } from "@litarcadewordle/shared-types";

function headline(result: TimedWordleGameEndedPayload): string {
  switch (result.reason) {
    case "solved":
      return `Found in ${result.summary.triesUsed} ${result.summary.triesUsed === 1 ? "try" : "tries"}`;
    case "tries_exhausted":
      return "Out of tries";
    case "time_expired":
      return "Time's up";
    case "admin_forced":
      return "Session ended by admin";
    default:
      return "Game over";
  }
}

export function GameEndScreen({ result }: { result: TimedWordleGameEndedPayload }) {
  const { eventId } = useParams<{ eventId: string }>();
  const [rank, setRank] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);
  // A player's own game can end long before everyone else's — showing rank
  // off a partial leaderboard would mean it visibly changes on them later as
  // more people finish, so it stays hidden entirely until the round closes.
  const roundClosed = result.roundStatus === "CLOSED";

  useEffect(() => {
    if (!roundClosed) return;
    apiClient
      .get<TimedWordleLeaderboardEntry[]>(`/player/events/${eventId}/timed-wordle/leaderboard`)
      .then((leaderboard) => {
        const mine = leaderboard.find((e) => e.sessionId === result.sessionId);
        if (mine) {
          setRank(mine.rank);
          setTotalPlayers(leaderboard.length);
        }
      })
      .catch(() => {});
  }, [eventId, result.sessionId, roundClosed]);

  const found = result.summary.found;

  return (
    <div className="flex min-h-screen flex-col bg-background px-5 py-6">
      <div
        className={cn(
          "rounded-xl border p-5 text-center",
          found ? "border-success/30 bg-success-subtle" : "border-destructive/30 bg-destructive-subtle"
        )}
      >
        <p className={cn("text-xs font-bold uppercase tracking-wide", found ? "text-success" : "text-destructive")}>
          {headline(result)}
        </p>
        <p className="mt-2 text-3xl font-extrabold uppercase tracking-[0.15em]">{result.secretWord}</p>
        {result.definition && <p className="mt-2 text-sm italic text-muted-foreground">{result.definition}</p>}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="time taken" value={formatMmSs(result.summary.cumulativeTimeMs)} />
        <Stat label="tries used" value={`${result.summary.triesUsed} / 6`} />
        <Stat label="tile score" value={String(result.summary.tileScore)} />
      </div>

      <div className="mt-5 rounded-xl border bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">Your rank</p>
        {!roundClosed ? (
          <Badge variant="secondary" className="mt-1">
            Hidden until the Prelims round closes for everyone
          </Badge>
        ) : rank === null ? (
          <Badge variant="secondary" className="mt-1">Calculating...</Badge>
        ) : (
          <p className="mt-1 text-3xl font-extrabold">
            #{rank}
            {totalPlayers ? <span className="ml-1 text-sm font-normal text-muted-foreground">of {totalPlayers}</span> : null}
          </p>
        )}
      </div>

      <Button asChild variant="outline" className="mt-6">
        <Link to={`/play/${eventId}/dashboard`}>Back to dashboard</Link>
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="font-mono text-lg font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
