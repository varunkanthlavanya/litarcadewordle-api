import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { TileColor, UnwordleLeaderboardEntry, UnwordleSessionMonitorEntry } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { useAdminLiveRefresh } from "@/hooks/useAdminLiveRefresh";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHhMmSsFromElapsed } from "@/hooks/useStopwatch";
import { UwPuzzleSetup } from "./UwPuzzleSetup";

const STATUS_BADGE: Record<string, StatusBadgeStatus> = {
  NOT_STARTED: "notStarted",
  IN_PROGRESS: "inProgress",
  COMPLETED: "completed",
  ENDED: "ended",
  EXITED: "exited",
};

export function UnwordleAdminPanel() {
  const { eventId } = useParams<{ eventId: string }>();
  const id = Number(eventId);

  const [puzzle, setPuzzle] = useState<{ solution_word: string; row_patterns: TileColor[][]; status: "DRAFT" | "PUBLISHED" } | null>(null);
  const [sessions, setSessions] = useState<UnwordleSessionMonitorEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<UnwordleLeaderboardEntry[]>([]);
  const [endAllOpen, setEndAllOpen] = useState(false);

  const loadPuzzle = useCallback(() => {
    apiClient
      .get(`/admin/events/${id}/unwordle/puzzle`)
      .then((p) => setPuzzle(p as typeof puzzle))
      .catch(() => setPuzzle(null));
  }, [id]);

  const loadSessions = useCallback(() => {
    apiClient.get<UnwordleSessionMonitorEntry[]>(`/admin/events/${id}/unwordle/sessions`).then(setSessions);
    apiClient
      .get<UnwordleLeaderboardEntry[]>(`/admin/events/${id}/unwordle/leaderboard`)
      .then(setLeaderboard)
      .catch(() => setLeaderboard([]));
  }, [id]);

  useEffect(() => {
    loadPuzzle();
    loadSessions();
  }, [loadPuzzle, loadSessions]);

  const { recentlyUpdated } = useAdminLiveRefresh(id, loadSessions);

  async function startSession(sessionId: number) {
    await apiClient.post(`/admin/events/${id}/unwordle/session/start`, { sessionId });
    loadSessions();
  }

  async function endSession(sessionId: number) {
    await apiClient.post(`/admin/events/${id}/unwordle/session/end`, { sessionId });
    loadSessions();
  }

  async function endAll() {
    await apiClient.post(`/admin/events/${id}/unwordle/session/endAll`, {});
    loadSessions();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Playoffs — UNWORDLE</h1>

      <UwPuzzleSetup eventId={id} puzzle={puzzle} onChanged={loadPuzzle} />

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Elapsed</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead className="w-20">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.sessionId} className={recentlyUpdated.has(s.sessionId) ? "row-flash" : undefined}>
                <TableCell>{s.displayName ?? s.mobileNumber}</TableCell>
                <TableCell>
                  <StatusBadge status={STATUS_BADGE[s.status] ?? "notStarted"} />
                </TableCell>
                <TableCell>{s.rowsSolvedCount} / 4</TableCell>
                <TableCell className="font-mono">{s.status === "NOT_STARTED" ? "—" : formatHhMmSsFromElapsed(s.elapsedMs)}</TableCell>
                <TableCell>{s.totalAttempts}</TableCell>
                <TableCell>
                  {s.status === "NOT_STARTED" && (
                    <button className="text-xs font-medium text-success hover:underline" onClick={() => startSession(s.sessionId)}>
                      Start
                    </button>
                  )}
                  {s.status === "IN_PROGRESS" && (
                    <button className="text-xs font-medium text-destructive hover:underline" onClick={() => endSession(s.sessionId)}>
                      End
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {sessions.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No finalists yet — advance players from the Cutoff Tool first.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <Button variant="destructive" onClick={() => setEndAllOpen(true)} disabled={sessions.every((s) => s.status !== "IN_PROGRESS")}>
          End Game for Everyone
        </Button>
      </div>

      <ConfirmDialog
        open={endAllOpen}
        onOpenChange={setEndAllOpen}
        title="End the game for everyone?"
        description="This force-ends every in-progress Playoffs session and reveals all answers. Continue?"
        confirmLabel="End Game for Everyone"
        onConfirm={endAll}
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Live leaderboard preview</h2>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.slice(0, 10).map((entry) => {
                const player = sessions.find((s) => s.eventPlayerId === entry.eventPlayerId);
                return (
                  <TableRow key={entry.sessionId}>
                    <TableCell>{entry.rank}</TableCell>
                    <TableCell>{player?.displayName ?? player?.mobileNumber ?? entry.eventPlayerId}</TableCell>
                    <TableCell>{entry.rowsSolvedCount} / 4</TableCell>
                    <TableCell className="font-mono">{formatHhMmSsFromElapsed(entry.totalTimeMs)}</TableCell>
                    <TableCell>{entry.totalAttempts}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
