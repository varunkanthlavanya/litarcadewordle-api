import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import type {
  UnwordleBankPuzzleDto,
  UnwordleBulkUploadResult,
  UnwordleLeaderboardEntry,
  UnwordleMonitorState,
  UnwordleSessionMonitorEntry,
} from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { useAdminLiveRefresh } from "@/hooks/useAdminLiveRefresh";
import { useCountdown, formatMmSs } from "@/hooks/useCountdown";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { UnwordleBankUploader } from "@/components/shared/UnwordleBankUploader";
import { UnwordleManualPuzzleForm } from "@/components/shared/UnwordleManualPuzzleForm";
import { UnwordleTilePreviewGrid } from "@/components/shared/UnwordleTilePreviewGrid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { EventWorkspaceContext } from "../events/EventWorkspaceLayout";

const MONITOR_BADGE: Record<UnwordleMonitorState, { status: StatusBadgeStatus; label: string }> = {
  PLAYING: { status: "inProgress", label: "Playing" },
  BANK_EXHAUSTED: { status: "completed", label: "Bank exhausted" },
  NOT_STARTED: { status: "notStarted", label: "Not started" },
  EXITED_PAUSED: { status: "exited", label: "Exited — paused" },
  ROUND_ENDED: { status: "ended", label: "Round ended" },
};

/** Exports this event's ENTIRE banked puzzle set in exactly the same
 * template shape UnwordleBankUploader's parser expects — so a bank built
 * for one event becomes a real, re-uploadable file for any future one via
 * the existing Bulk Upload path, with no new upload-side code needed. */
function downloadBankAsXlsx(eventId: number, eventName: string, puzzles: UnwordleBankPuzzleDto[]) {
  const rows: Array<Array<string | number>> = [
    ["puzzle_number", "solution_word", "row_1_pattern", "row_2_pattern", "row_3_pattern", "row_4_pattern"],
    ...[...puzzles]
      .sort((a, b) => a.puzzleNumber - b.puzzleNumber)
      .map((p) => [p.puzzleNumber, p.solutionWord, ...p.rowPatterns.map((row) => row.join(","))]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 30 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Puzzle Bank");
  const safeName = eventName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  XLSX.writeFile(wb, `unwordle-bank-event-${eventId}${safeName ? `-${safeName}` : ""}.xlsx`);
}

export function UnwordleAdminPanel() {
  const { eventId } = useParams<{ eventId: string }>();
  const id = Number(eventId);
  const { event, reload } = useOutletContext<EventWorkspaceContext>();

  const [bank, setBank] = useState<{ bankSize: number; puzzles: UnwordleBankPuzzleDto[] }>({ bankSize: event.unwordle_bank_size, puzzles: [] });
  const [sessions, setSessions] = useState<UnwordleSessionMonitorEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<UnwordleLeaderboardEntry[]>([]);
  const [roundDurationMinutes, setRoundDurationMinutes] = useState(Math.round(event.unwordle_round_duration_ms / 60000));
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [endRoundOpen, setEndRoundOpen] = useState(false);

  const loadBank = useCallback(() => {
    apiClient
      .get<{ bankSize: number; puzzles: UnwordleBankPuzzleDto[] }>(`/admin/events/${id}/unwordle/bank`)
      .then(setBank)
      .catch(() => {});
  }, [id]);

  const loadSessions = useCallback(() => {
    apiClient
      .get<UnwordleSessionMonitorEntry[]>(`/admin/events/${id}/unwordle/sessions`)
      .then(setSessions)
      .catch(() => setSessions([]));
    apiClient
      .get<UnwordleLeaderboardEntry[]>(`/admin/events/${id}/unwordle/leaderboard`)
      .then(setLeaderboard)
      .catch(() => setLeaderboard([]));
  }, [id]);

  useEffect(() => {
    loadBank();
    loadSessions();
  }, [loadBank, loadSessions]);

  useAdminLiveRefresh(id, loadSessions);

  const roundStarted = !!event.unwordle_round_started_at;
  const roundEndsAtMs = event.unwordle_round_ends_at ? new Date(event.unwordle_round_ends_at).getTime() : null;
  const remainingMs = useCountdown(roundStarted ? roundEndsAtMs : null);
  const roundEnded = roundStarted && roundEndsAtMs !== null && Date.now() >= roundEndsAtMs;

  const publishedCount = bank.puzzles.filter((p) => p.status === "PUBLISHED").length;
  const bankedCount = bank.puzzles.length;
  const bankComplete = bankedCount === bank.bankSize;
  const bankFullyPublished = publishedCount === bank.bankSize && bankComplete;

  function handleBankUploaded(result: UnwordleBulkUploadResult) {
    if (result.errors.length === 0) {
      setBank({ bankSize: result.bankSize, puzzles: [] });
      loadBank();
    }
  }

  async function publishBank() {
    setError(null);
    setPublishing(true);
    try {
      await apiClient.post(`/admin/events/${id}/unwordle/bank/publish`, {});
      loadBank();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish bank");
    } finally {
      setPublishing(false);
    }
  }

  async function startRound() {
    setError(null);
    setStarting(true);
    try {
      await apiClient.post(`/admin/events/${id}/unwordle/round/start`, { roundDurationMs: roundDurationMinutes * 60000 });
      reload();
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start round");
    } finally {
      setStarting(false);
    }
  }

  async function endRoundNow() {
    await apiClient.post(`/admin/events/${id}/unwordle/round/end`, {});
    reload();
    loadSessions();
  }

  async function resumePlayer(eventPlayerId: number) {
    await apiClient.post(`/admin/events/${id}/unwordle/round/resume`, { eventPlayerId });
    loadSessions();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Playoffs — UNWORDLE</h1>
        {bank.puzzles.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadBankAsXlsx(id, event.name, bank.puzzles)}
          >
            <Download className="mr-2 h-4 w-4" />
            Download Bank (.xlsx) — reuse in future events
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!roundStarted ? (
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              Puzzle bank: <span className="font-mono">{bankedCount} / {bank.bankSize}</span> banked
              {bankComplete && <span className="text-muted-foreground"> · {publishedCount} / {bank.bankSize} published</span>}
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="roundDuration" className="text-xs">Round length (min)</Label>
              <Input
                id="roundDuration"
                type="number"
                min={1}
                className="w-20"
                value={roundDurationMinutes}
                onChange={(e) => setRoundDurationMinutes(Number(e.target.value))}
              />
            </div>
          </div>

          <Tabs defaultValue="bulk">
            <TabsList>
              <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
              <TabsTrigger value="manual">Manual Tile Coloring</TabsTrigger>
            </TabsList>
            <TabsContent value="bulk">
              <UnwordleBankUploader eventId={id} onUploaded={handleBankUploaded} />
            </TabsContent>
            <TabsContent value="manual">
              <UnwordleManualPuzzleForm eventId={id} bankSize={bank.bankSize} existingPuzzles={bank.puzzles} onSaved={loadBank} />
            </TabsContent>
          </Tabs>

          <UnwordleTilePreviewGrid puzzles={bank.puzzles} />

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={publishBank} disabled={!bankComplete || bankFullyPublished || publishing}>
              {publishing ? "Publishing..." : bankFullyPublished ? "Bank published" : "Publish Bank"}
            </Button>
            <Button onClick={startRound} disabled={!bankFullyPublished || starting}>
              {starting ? "Starting..." : "Start Round"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {roundEnded ? "Round ended" : "Round ends in"}
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums">{roundEnded ? "00:00" : formatMmSs(remainingMs)}</p>
          </div>
          {!roundEnded && (
            <Button variant="destructive" onClick={() => setEndRoundOpen(true)}>
              End Round Now
            </Button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Puzzle</TableHead>
              <TableHead>Rows (current)</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead className="w-24">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => {
              const badge = MONITOR_BADGE[s.monitorState];
              return (
                <TableRow key={s.eventPlayerId}>
                  <TableCell>{s.displayName ?? s.mobileNumber}</TableCell>
                  <TableCell>
                    <StatusBadge status={badge.status} label={badge.label} />
                  </TableCell>
                  <TableCell>{s.puzzleNumber !== null ? `${s.puzzleNumber} / ${s.bankSize}` : "—"}</TableCell>
                  <TableCell>{s.puzzleNumber !== null ? `${s.rowsSolvedInCurrentPuzzle} / 4` : "—"}</TableCell>
                  <TableCell className="font-mono">{s.totalPoints}</TableCell>
                  <TableCell>{s.totalAttempts}</TableCell>
                  <TableCell>
                    {s.monitorState === "EXITED_PAUSED" && !roundEnded && (
                      <button className="text-xs font-medium text-success hover:underline" onClick={() => resumePlayer(s.eventPlayerId)}>
                        Resume
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {sessions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No finalists yet — advance players from the Cutoff Tool first.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={endRoundOpen}
        onOpenChange={setEndRoundOpen}
        title="End the round now?"
        description="This force-stops every player's current puzzle immediately and reveals all answers, exactly as if the round's own countdown had reached zero. Continue?"
        confirmLabel="End Round Now"
        onConfirm={endRoundNow}
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Live leaderboard preview</h2>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Puzzles completed</TableHead>
                <TableHead>Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.slice(0, 10).map((entry) => (
                <TableRow key={entry.eventPlayerId}>
                  <TableCell>{entry.rank}</TableCell>
                  <TableCell>{entry.displayName ?? entry.eventPlayerId}</TableCell>
                  <TableCell className="font-mono">{entry.totalPoints}</TableCell>
                  <TableCell>{entry.totalPuzzlesCompleted} / {bank.bankSize}</TableCell>
                  <TableCell>{entry.totalAttempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
