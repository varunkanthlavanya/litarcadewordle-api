import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  const navigate = useNavigate();

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
    // A partial leaderboard while the round is still OPEN would show a rank
    // that keeps shifting as more players finish — only reveal it once the
    // round has actually CLOSED for everyone.
    if (!tw || tw.roundStatus !== "CLOSED") {
      setTwLeaderboard(null);
      return;
    }
    apiClient
      .get<TimedWordleLeaderboardEntry[]>(`/player/events/${eventId}/timed-wordle/leaderboard`)
      .then(setTwLeaderboard)
      .catch(() => {});
  }, [tw?.roundStatus, eventId]);

  useEffect(() => {
    // Same reasoning as the Timed Wordle leaderboard above — don't reveal a
    // partial ranking while the round is still going for anyone.
    if (!uw?.roundEnded) {
      setUwLeaderboard(null);
      return;
    }
    apiClient
      .get<UnwordleLeaderboardEntry[]>(`/player/events/${eventId}/unwordle/leaderboard`)
      .then(setUwLeaderboard)
      .catch(() => {});
  }, [uw?.roundEnded, eventId]);

  const opensAtMs = tw?.roundStatus === "SCHEDULED" && tw.roundOpensAt ? new Date(tw.roundOpensAt).getTime() : null;
  const remainingMs = useCountdown(opensAtMs);

  async function handleLogout() {
    await apiClient.post("/player/auth/logout").catch(() => {});
    navigate("/");
  }

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
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Event</p>
          <h1 className="text-2xl font-bold">{tw.eventName}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sign out
        </Button>
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

            {!uw || uw.playerState === "NOT_A_FINALIST" ? (
              <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Only Prelims finalists advance to Playoffs</p>
              </div>
            ) : uw.playerState === "AWAITING_ROUND_START" ? (
              <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
                <Badge variant="accent" className="w-fit">You're a finalist</Badge>
                <p className="text-sm text-muted-foreground">Waiting for the admin to start your round</p>
              </div>
            ) : uw.playerState === "READY_TO_ENTER" ? (
              <div className="mt-3 flex flex-1 flex-col justify-end gap-3">
                <Badge variant="accent" className="w-fit">You're a finalist</Badge>
                <p className="text-sm text-muted-foreground">
                  The round is open — your personal clock starts the moment you jump in.
                </p>
                <Button asChild className="w-full">
                  <Link to={`/play/${eventId}/unwordle/game`}>Play now</Link>
                </Button>
              </div>
            ) : uw.playerState === "PLAYING" ? (
              <div className="mt-3 flex flex-1 flex-col justify-end gap-3">
                <Badge variant="info" className="w-fit">
                  Puzzle {uw.puzzleNumber} / {uw.bankSize} · {uw.totalPoints} pts
                </Badge>
                <Button asChild className="w-full">
                  {/* This player has already entered (their own clock is
                      running) — zero attempts on the CURRENT puzzle means
                      they've never actually submitted a guess on it, so
                      "Resume" would be misleading there specifically. */}
                  <Link to={`/play/${eventId}/unwordle/game`}>
                    {uw.state?.totalAttempts === 0 ? "Start" : "Resume"}
                  </Link>
                </Button>
              </div>
            ) : uw.playerState === "EXITED_AWAITING_RESUME" ? (
              <div className="mt-3 flex-1 space-y-3">
                <div className="rounded-md border bg-muted/40 p-3 text-center">
                  <p className="text-xs font-bold uppercase text-muted-foreground">{uw.totalPoints} points so far</p>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  You stepped away — ask an admin to resume you when you're ready.
                </p>
              </div>
            ) : (
              // BANK_EXHAUSTED_WAITING or ROUND_ENDED
              <div className="mt-3 flex-1 space-y-3">
                <div className="rounded-md border bg-muted/40 p-3 text-center">
                  <p className="text-xs font-bold uppercase text-muted-foreground">{uw.totalPoints} points</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div>
                    <p className="font-mono font-bold">{uw.totalPuzzlesCompleted} / {uw.bankSize}</p>
                    <p className="text-muted-foreground">puzzles</p>
                  </div>
                  <div>
                    <p className="font-mono font-bold">
                      {uw.playerState === "BANK_EXHAUSTED_WAITING" ? "Waiting" : "Ended"}
                    </p>
                    <p className="text-muted-foreground">round status</p>
                  </div>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/play/${eventId}/unwordle/results`}>View full result</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {twLeaderboard && twLeaderboard.length > 0 && (
        <LeaderboardSection
          title="Prelims Leaderboard"
          rows={twLeaderboard.map((e) => ({
            key: e.sessionId,
            isMe: e.sessionId === tw.sessionId,
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
          rows={uwLeaderboard.map((e) => ({
            key: e.eventPlayerId,
            isMe: e.eventPlayerId === uw?.eventPlayerId,
            rank: e.rank,
            name: e.displayName,
            cells: [String(e.totalPoints), `${e.totalPuzzlesCompleted}`, String(e.totalAttempts)],
          }))}
          columns={["Points", "Puzzles", "Attempts"]}
        />
      )}
    </div>
  );
}

function LeaderboardSection({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<{ key: number; isMe: boolean; rank: number; name: string | null; cells: string[] }>;
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
            {rows.map((r) => (
              <TableRow key={r.key} className={cn(r.isMe && "bg-accent/15")}>
                <TableCell>{r.rank}</TableCell>
                <TableCell className="font-medium">{r.isMe ? "You" : r.name ?? `Player ${r.key}`}</TableCell>
                {r.cells.map((cell, i) => (
                  <TableCell key={i} className={i === 0 ? undefined : "font-mono"}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
