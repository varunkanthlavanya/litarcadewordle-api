import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Clock, X } from "lucide-react";
import type { UnwordleLeaderboardEntry, UnwordleRoundStatusDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCountdown, formatMmSs } from "@/hooks/useCountdown";
import { EntertainmentPartners } from "@/components/shared/EntertainmentPartners";
import { cn } from "@/lib/utils";

/** Round summary — replaces the old "one puzzle's 4-row breakdown" screen.
 * The unit of achievement is now the whole round: total points, puzzles
 * completed out of the bank, and (only) the most recent/cut-off puzzle's
 * row reveal — a full history across every puzzle attempted this round is
 * an explicit non-goal (PRD Rev 3 §12). */
export function UnwordleResults() {
  const { eventId } = useParams<{ eventId: string }>();
  const [status, setStatus] = useState<UnwordleRoundStatusDto | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);

  useEffect(() => {
    apiClient.get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`).then(setStatus);
  }, [eventId]);

  const remainingMs = useCountdown(status?.roundEnded ? null : status?.roundEndsAt ?? null);

  useEffect(() => {
    // Rank can only be revealed once the round itself has ended — before
    // that, it would visibly shift as other players keep playing.
    if (!status || !status.roundEnded) return;
    apiClient
      .get<UnwordleLeaderboardEntry[]>(`/player/events/${eventId}/unwordle/leaderboard`)
      .then((leaderboard) => {
        const mine = leaderboard.find((e) => e.eventPlayerId === status.eventPlayerId);
        if (mine) {
          setRank(mine.rank);
          setTotalPlayers(leaderboard.length);
        }
      })
      .catch(() => {});
  }, [status, eventId]);

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (status.playerState === "NOT_A_FINALIST" || status.playerState === "AWAITING_ROUND_START") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-5 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {status.playerState === "NOT_A_FINALIST" ? "You didn't advance to Playoffs this time." : "The Playoffs round hasn't started yet."}
        </p>
        <Button asChild variant="outline">
          <Link to={`/play/${eventId}/dashboard`}>Back to dashboard</Link>
        </Button>
        <EntertainmentPartners />
      </div>
    );
  }

  const rows = status.ended?.rows ?? [];
  const revealedAnswers = status.ended?.revealedAnswers ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-background px-5 py-6">
      <div className="text-center">
        <p className="text-4xl font-extrabold">{status.totalPoints}</p>
        <p className="text-sm text-muted-foreground">points this round</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {status.totalPuzzlesCompleted} of {status.bankSize} puzzles completed
        </p>
      </div>

      {status.playerState === "BANK_EXHAUSTED_WAITING" && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border bg-success-subtle p-5 text-center">
          <p className="font-semibold text-success">
            You've completed every puzzle in the bank — nice work!
          </p>
          <p className="text-sm text-muted-foreground">Waiting for the round to end.</p>
          {status.roundEndsAt !== null && (
            <div className="mt-1 flex items-center gap-1.5 font-mono text-lg font-bold tabular-nums">
              <Clock className="h-4 w-4" />
              {formatMmSs(remainingMs)}
            </div>
          )}
        </div>
      )}

      {status.playerState === "EXITED_AWAITING_RESUME" && (
        <div className="mt-6 rounded-xl border bg-muted/40 p-5 text-center">
          <p className="font-semibold">You stepped away from the round.</p>
          <p className="text-sm text-muted-foreground">Ask an admin to resume you when you're ready to continue.</p>
        </div>
      )}

      {status.playerState === "ROUND_ENDED" && rows.length > 0 && (
        <>
          <p className="mt-6 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your last puzzle (puzzle {status.puzzleNumber})
          </p>
          <div className="mt-2 overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Word</TableHead>
                  <TableHead>Tries</TableHead>
                  <TableHead>Invalid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i} className={cn(!row.solved && "bg-destructive-subtle")}>
                    <TableCell className="flex items-center gap-1.5">
                      {i + 1}
                      {row.solved ? <Check className="h-3.5 w-3.5 text-success" /> : <X className="h-3.5 w-3.5 text-destructive" />}
                    </TableCell>
                    <TableCell className={cn("font-mono", !row.solved && "text-destructive")}>
                      {row.solvedWord ?? revealedAnswers[i] ?? "—"}
                    </TableCell>
                    <TableCell>{row.attempts}</TableCell>
                    <TableCell>{row.invalidSubmissions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <div className="mt-6 rounded-xl border bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">Leaderboard rank</p>
        {!status.roundEnded ? (
          <p className="mt-1 text-sm text-muted-foreground">Hidden until the round ends for everyone</p>
        ) : rank ? (
          <p className="mt-1 text-3xl font-extrabold">
            #{rank}
            {totalPlayers ? <span className="ml-1 text-sm font-normal text-muted-foreground">of {totalPlayers}</span> : null}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Calculating...</p>
        )}
      </div>

      <Button asChild variant="outline" className="mx-auto mt-6">
        <Link to={`/play/${eventId}/dashboard`}>Back to dashboard</Link>
      </Button>

      <EntertainmentPartners />
    </div>
  );
}
