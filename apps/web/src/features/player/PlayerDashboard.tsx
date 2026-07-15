import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Lock, Clock } from "lucide-react";
import type {
  TimedWordleLeaderboardEntry,
  TimedWordleRoundStatusDto,
  UnwordleLeaderboardEntry,
  UnwordleRoundStatusDto,
} from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHhMmSs, formatMmSs, useCountdown } from "@/hooks/useCountdown";
import { formatHhMmSsFromElapsed } from "@/hooks/useStopwatch";
import { cn } from "@/lib/utils";

const POLL_MS = 10_000;

function timedWordleHeadline(result: NonNullable<TimedWordleRoundStatusDto["result"]>): string {
  switch (result.reason) {
    case "solved":
      return `Found in ${result.triesUsed} ${result.triesUsed === 1 ? "try" : "tries"}`;
    case "tries_exhausted":
      return "Out of tries";
    case "time_expired":
      return "Time's up";
    case "admin_forced":
      return "Ended by admin";
    default:
      return "Game over";
  }
}

/** The player's home base for an event — replaces the old auto-redirect-into-
 * whichever-game-is-next flow with something the player actually drives: see
 * both games' current availability at a glance, jump into whichever is open,
 * revisit a finished game's result, and check the full leaderboard. Whether a
 * game is playable is entirely admin-controlled (round/puzzle status, cutoff
 * advancement, session start) — this page only ever reflects that state, never
 * decides it. */
export function PlayerDashboard() {
  const { eventId } = useParams<{ eventId: string }>();

  const [tw, setTw] = useState<TimedWordleRoundStatusDto | null>(null);
  const [twLeaderboard, setTwLeaderboard] = useState<TimedWordleLeaderboardEntry[] | null>(null);
  const [uw, setUw] = useState<UnwordleRoundStatusDto | null>(null);
  const [uwLeaderboard, setUwLeaderboard] = useState<UnwordleLeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      apiClient
        .get<TimedWordleRoundStatusDto>(`/player/events/${eventId}/timed-wordle/status`)
        .then((res) => {
          if (!cancelled) setTw(res);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this event");
        });
      apiClient
        .get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`)
        .then((res) => {
          if (!cancelled) setUw(res);
        })
        .catch(() => {
          // No UNWORDLE puzzle yet, or not a finalist — the card just stays locked.
        });
    }
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [eventId]);

  useEffect(() => {
    if (!tw || tw.roundStatus === "SCHEDULED") return;
    apiClient
      .get<TimedWordleLeaderboardEntry[]>(`/player/events/${eventId}/timed-wordle/leaderboard`)
      .then(setTwLeaderboard)
      .catch(() => {});
  }, [tw?.roundStatus, eventId]);

  useEffect(() => {
    if (!uw?.isFinalist || uw.sessionStatus === "NOT_STARTED") return;
    apiClient
      .get<UnwordleLeaderboardEntry[]>(`/player/events/${eventId}/unwordle/leaderboard`)
      .then(setUwLeaderboard)
      .catch(() => {});
  }, [uw?.isFinalist, uw?.sessionStatus, eventId]);

  const opensAtMs = tw?.roundStatus === "SCHEDULED" && tw.roundOpensAt ? new Date(tw.roundOpensAt).getTime() : null;
  const remainingMs = useCountdown(opensAtMs);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!tw) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-5 py-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Event</p>
        <h1 className="text-2xl font-bold">{tw.eventName}</h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* ---------------- Timed Wordle (Prelims) ---------------- */}
        <Card>
          <CardContent className="flex h-full flex-col p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Timed Wordle</h2>
              <Badge variant="secondary">Prelims</Badge>
            </div>

            {tw.result ? (
              <div className="mt-3 flex-1 space-y-3">
                <div
                  className={cn(
                    "rounded-md border p-3 text-center",
                    tw.result.found ? "border-success/30 bg-success-subtle" : "border-destructive/30 bg-destructive-subtle"
                  )}
                >
                  <p className={cn("text-xs font-bold uppercase", tw.result.found ? "text-success" : "text-destructive")}>
                    {timedWordleHeadline(tw.result)}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="font-mono font-bold">{formatMmSs(tw.result.cumulativeTimeMs)}</p>
                    <p className="text-muted-foreground">time</p>
                  </div>
                  <div>
                    <p className="font-mono font-bold">{tw.result.triesUsed}/6</p>
                    <p className="text-muted-foreground">tries</p>
                  </div>
                  <div>
                    <p className="font-mono font-bold">{tw.result.tileScore}</p>
                    <p className="text-muted-foreground">score</p>
                  </div>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/play/${eventId}/results`}>View full result</Link>
                </Button>
              </div>
            ) : tw.sessionStatus === "IN_PROGRESS" ? (
              <div className="mt-3 flex flex-1 flex-col justify-end gap-3">
                <Badge variant="info" className="w-fit">In progress</Badge>
                <Button asChild className="w-full">
                  <Link to={`/play/${eventId}/game`}>Resume</Link>
                </Button>
              </div>
            ) : tw.roundStatus === "OPEN" ? (
              <div className="mt-3 flex flex-1 flex-col justify-end gap-3">
                <p className="text-sm text-muted-foreground">The round is open — jump in whenever you're ready.</p>
                <Button asChild className="w-full">
                  <Link to={`/play/${eventId}/game`}>Play now</Link>
                </Button>
              </div>
            ) : tw.roundStatus === "SCHEDULED" ? (
              <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
                {opensAtMs !== null && remainingMs > 0 ? (
                  <>
                    <p className="font-mono text-lg font-bold tabular-nums">{formatHhMmSs(remainingMs)}</p>
                    <p className="text-xs text-muted-foreground">until it opens</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Not open yet</p>
                )}
              </div>
            ) : (
              <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Round closed — you didn't play this one</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------------- UNWORDLE (Playoffs) ---------------- */}
        <Card>
          <CardContent className="flex h-full flex-col p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">UNWORDLE</h2>
              <Badge variant="secondary">Playoffs</Badge>
            </div>

            {!uw || !uw.isFinalist ? (
              <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Only Prelims finalists advance to Playoffs</p>
              </div>
            ) : uw.ended ? (
              <div className="mt-3 flex-1 space-y-3">
                <div className="rounded-md border bg-muted/40 p-3 text-center">
                  <p className="text-xs font-bold uppercase text-muted-foreground">
                    {uw.ended.summary.rowsSolvedCount} / 4 rows solved
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div>
                    <p className="font-mono font-bold">{formatHhMmSsFromElapsed(uw.ended.summary.totalTimeMs)}</p>
                    <p className="text-muted-foreground">time</p>
                  </div>
                  <div>
                    <p className="font-mono font-bold">{uw.ended.summary.totalAttempts}</p>
                    <p className="text-muted-foreground">attempts</p>
                  </div>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/play/${eventId}/unwordle/results`}>View full result</Link>
                </Button>
              </div>
            ) : uw.sessionStatus === "IN_PROGRESS" ? (
              <div className="mt-3 flex flex-1 flex-col justify-end gap-3">
                <Badge variant="info" className="w-fit">In progress</Badge>
                <Button asChild className="w-full">
                  <Link to={`/play/${eventId}/unwordle/game`}>Resume</Link>
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
                <Badge variant="accent" className="w-fit">You're a finalist</Badge>
                <p className="text-sm text-muted-foreground">Waiting for the admin to start your round</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {twLeaderboard && twLeaderboard.length > 0 && (
        <LeaderboardSection
          title="Prelims Leaderboard"
          mySessionId={tw.sessionId}
          rows={twLeaderboard.map((e) => ({
            sessionId: e.sessionId,
            rank: e.rank,
            name: e.displayName,
            cells: [e.found ? "Found" : "Not found", formatMmSs(e.cumulativeTimeMs), `${e.triesUsed}/6`, String(e.tileScore)],
          }))}
          columns={["Result", "Time", "Tries", "Score"]}
        />
      )}

      {uwLeaderboard && uwLeaderboard.length > 0 && (
        <LeaderboardSection
          title="Playoffs Leaderboard"
          mySessionId={uw?.sessionId ?? null}
          rows={uwLeaderboard.map((e) => ({
            sessionId: e.sessionId,
            rank: e.rank,
            name: e.displayName,
            cells: [`${e.rowsSolvedCount}/4`, formatHhMmSsFromElapsed(e.totalTimeMs), String(e.totalAttempts)],
          }))}
          columns={["Rows", "Time", "Attempts"]}
        />
      )}
    </div>
  );
}

function LeaderboardSection({
  title,
  mySessionId,
  columns,
  rows,
}: {
  title: string;
  mySessionId: number | null;
  columns: string[];
  rows: Array<{ sessionId: number; rank: number; name: string | null; cells: string[] }>;
}) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Player</TableHead>
              {columns.map((c) => (
                <TableHead key={c}>{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isMe = r.sessionId === mySessionId;
              return (
                <TableRow key={r.sessionId} className={cn(isMe && "bg-accent/15")}>
                  <TableCell>{r.rank}</TableCell>
                  <TableCell className="font-medium">
                    {isMe ? "You" : r.name ?? `Player ${r.sessionId}`}
                  </TableCell>
                  {r.cells.map((cell, i) => (
                    <TableCell key={i} className={i === 0 ? undefined : "font-mono"}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
