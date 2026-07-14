import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, X } from "lucide-react";
import type { UnwordleLeaderboardEntry, UnwordleRoundStatusDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHhMmSsFromElapsed } from "@/hooks/useStopwatch";
import { cn } from "@/lib/utils";

const STATUS_MAP: Record<string, StatusBadgeStatus> = {
  COMPLETED: "completed",
  ENDED: "ended",
  EXITED: "exited",
};

export function UnwordleResults() {
  const { eventId } = useParams<{ eventId: string }>();
  const [status, setStatus] = useState<UnwordleRoundStatusDto | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);

  useEffect(() => {
    apiClient.get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`).then(setStatus);
  }, [eventId]);

  useEffect(() => {
    if (!status?.sessionId || status.sessionStatus === "EXITED") return;
    apiClient
      .get<UnwordleLeaderboardEntry[]>(`/player/events/${eventId}/unwordle/leaderboard`)
      .then((leaderboard) => {
        const mine = leaderboard.find((e) => e.sessionId === status.sessionId);
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

  const rows = status.ended?.rows ?? status.state?.rows ?? [];
  const revealedAnswers = status.ended?.revealedAnswers ?? [];
  const rowsSolvedCount = status.ended?.summary.rowsSolvedCount ?? status.state?.rowsSolvedCount ?? 0;
  const totalTimeMs = status.ended?.summary.totalTimeMs ?? status.state?.totalTimeMs ?? 0;
  const isExited = status.sessionStatus === "EXITED";

  return (
    <div className="flex min-h-screen flex-col bg-background px-5 py-6">
      <div className="flex items-center justify-between">
        <StatusBadge status={STATUS_MAP[status.sessionStatus ?? ""] ?? "notStarted"} />
        <span className="font-mono text-sm font-semibold">{formatHhMmSsFromElapsed(totalTimeMs)} elapsed</span>
      </div>

      <div className="mt-6 text-center">
        <p className="text-4xl font-extrabold">
          {rowsSolvedCount} of {rows.length || 4}
        </p>
        <p className="text-sm text-muted-foreground">rows solved</p>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border">
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
                  {row.solved ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-destructive" />
                  )}
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

      <div className="mt-6 rounded-xl border bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">Leaderboard rank</p>
        {isExited ? (
          <p className="mt-1 text-lg font-semibold text-muted-foreground">Not ranked</p>
        ) : rank ? (
          <p className="mt-1 text-3xl font-extrabold">
            #{rank}
            {totalPlayers ? <span className="ml-1 text-sm font-normal text-muted-foreground">of {totalPlayers}</span> : null}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Pending</p>
        )}
      </div>

      <Button asChild variant="outline" className="mx-auto mt-6">
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  );
}
