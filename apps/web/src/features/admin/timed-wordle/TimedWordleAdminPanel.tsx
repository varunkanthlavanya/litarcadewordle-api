import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  TimedWordleLeaderboardEntry,
  TimedWordlePlayerState,
  TimedWordleSessionMonitorEntry,
} from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { emitWithAck, getAdminSocket, waitForConnection } from "@/lib/socketClient";
import { useAdminLiveRefresh } from "@/hooks/useAdminLiveRefresh";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { BackLink } from "@/components/shared/BackLink";
import { PresenceDot } from "@/components/shared/PresenceDot";
import { SessionMonitorTable } from "@/components/shared/SessionMonitorTable";
import { BulkActionsBar } from "@/components/shared/BulkActionsBar";
import { ClockAdjustControl } from "@/components/shared/ClockAdjustControl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMmSs } from "@/hooks/useCountdown";
import { TwPuzzleSetupBar } from "./TwPuzzleSetupBar";

const PLAYER_STATE_BADGE: Record<TimedWordlePlayerState, StatusBadgeStatus> = {
  IDLE: "idle",
  IN_GAME: "inGame",
  POST_GAME: "postGame",
};

const FILTERS = ["All", "Online", "In Game", "Post-Game"] as const;

export function TimedWordleAdminPanel() {
  const { eventId } = useParams<{ eventId: string }>();
  const id = Number(eventId);

  const [puzzle, setPuzzle] = useState<{ secret_word: string; definition: string | null; status: "SCHEDULED" | "OPEN" | "CLOSED" } | null>(null);
  const [sessions, setSessions] = useState<TimedWordleSessionMonitorEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<TimedWordleLeaderboardEntry[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adjustingPlayer, setAdjustingPlayer] = useState<TimedWordleSessionMonitorEntry | null>(null);

  const loadPuzzle = useCallback(() => {
    apiClient
      .get(`/admin/events/${id}/timed-wordle/puzzle`)
      .then((p) => setPuzzle(p as typeof puzzle))
      .catch(() => setPuzzle(null));
  }, [id]);

  const loadSessions = useCallback(() => {
    apiClient.get<TimedWordleSessionMonitorEntry[]>(`/admin/events/${id}/timed-wordle/sessions`).then(setSessions);
    apiClient
      .get<TimedWordleLeaderboardEntry[]>(`/admin/events/${id}/timed-wordle/leaderboard`)
      .then(setLeaderboard)
      .catch(() => setLeaderboard([]));
  }, [id]);

  useEffect(() => {
    loadPuzzle();
    loadSessions();
  }, [loadPuzzle, loadSessions]);

  const { recentlyUpdated } = useAdminLiveRefresh(id, loadSessions);

  const filteredRows = useMemo(() => {
    return sessions.filter((r) => {
      if (search && !`${r.displayName ?? ""} ${r.mobileNumber}`.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (filter === "Online" && !r.online) return false;
      if (filter === "In Game" && r.playerState !== "IN_GAME") return false;
      if (filter === "Post-Game" && r.playerState !== "POST_GAME") return false;
      return true;
    });
  }, [sessions, search, filter]);

  async function endOne(eventPlayerId: number) {
    const row = sessions.find((s) => s.eventPlayerId === eventPlayerId);
    if (!row?.sessionId) return;
    const socket = getAdminSocket();
    await waitForConnection(socket);
    await emitWithAck(socket, "admin:tw:session:end", { sessionId: row.sessionId });
    loadSessions();
  }

  async function endSelected() {
    const sessionIds = [...selected]
      .map((eventPlayerId) => sessions.find((s) => s.eventPlayerId === eventPlayerId)?.sessionId)
      .filter((v): v is number => v != null);
    const socket = getAdminSocket();
    await waitForConnection(socket);
    await emitWithAck(socket, "admin:tw:session:bulkEnd", { sessionIds });
    setSelected(new Set());
    loadSessions();
  }

  async function endAll() {
    const sessionIds = sessions.map((s) => s.sessionId).filter((v): v is number => v != null && v !== undefined);
    const socket = getAdminSocket();
    await waitForConnection(socket);
    await emitWithAck(socket, "admin:tw:session:bulkEnd", { sessionIds });
    loadSessions();
  }

  async function adjustClock(eventPlayerId: number, deltaSeconds: number, scope: "GLOBAL" | "CURRENT_TRY") {
    const row = sessions.find((s) => s.eventPlayerId === eventPlayerId);
    if (!row?.sessionId) return;
    const socket = getAdminSocket();
    await waitForConnection(socket);
    await emitWithAck(socket, "admin:tw:clock:adjust", { sessionId: row.sessionId, deltaSeconds, scope });
    loadSessions();
  }

  function toggleSelect(eventPlayerId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventPlayerId)) next.delete(eventPlayerId);
      else next.add(eventPlayerId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const pageIds = filteredRows.map((r) => r.eventPlayerId);
      const allSelected = pageIds.every((id2) => prev.has(id2));
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id2) => next.delete(id2));
      else pageIds.forEach((id2) => next.add(id2));
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <BackLink to={`/admin/events/${id}`} label="Back to Event Control Center" />
      <h1 className="text-2xl font-bold">Prelims — Timed Wordle</h1>

      <TwPuzzleSetupBar eventId={id} puzzle={puzzle} onChanged={loadPuzzle} />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search player or mobile number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
              {f}
            </Button>
          ))}
        </div>
      </div>

      <SessionMonitorTable
        rows={filteredRows}
        totalCount={sessions.length}
        getRowId={(r) => r.eventPlayerId}
        selectedIds={selected}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        recentlyUpdatedIds={new Set([...recentlyUpdated])}
        columns={[
          {
            key: "player",
            header: "Player",
            render: (r) => r.displayName ?? r.mobileNumber,
          },
          {
            key: "presence",
            header: "Presence",
            render: (r) => <PresenceDot online={r.online} label={r.online ? "Online" : "Offline"} />,
          },
          {
            key: "state",
            header: "State",
            render: (r) => (
              <StatusBadge
                status={PLAYER_STATE_BADGE[r.playerState]}
                label={r.playerState === "IN_GAME" ? `In Game — Try ${r.currentTryNumber ?? "?"}/6` : undefined}
              />
            ),
          },
          {
            key: "lastActivity",
            header: "Last Activity",
            className: "font-mono text-xs",
            render: (r) => (r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleTimeString() : "—"),
          },
          {
            key: "elapsed",
            header: "Elapsed",
            className: "font-mono",
            render: (r) => (r.elapsedMs !== null ? formatMmSs(r.elapsedMs) : "—"),
          },
        ]}
        action={(r) => (
          <div className="flex gap-2">
            {r.sessionId && r.playerState === "IN_GAME" && (
              <button className="text-xs font-medium text-warning hover:underline" onClick={() => setAdjustingPlayer(r)}>
                Clock
              </button>
            )}
            {r.sessionId && r.playerState !== "POST_GAME" && (
              <button className="text-xs font-medium text-destructive hover:underline" onClick={() => endOne(r.eventPlayerId)}>
                End
              </button>
            )}
          </div>
        )}
      />

      {adjustingPlayer && (
        <ClockAdjustControl
          playerLabel={adjustingPlayer.displayName ?? adjustingPlayer.mobileNumber}
          onCancel={() => setAdjustingPlayer(null)}
          onAdjust={(delta, scope) => adjustClock(adjustingPlayer.eventPlayerId, delta, scope)}
        />
      )}

      <BulkActionsBar
        selectedCount={selected.size}
        totalCount={sessions.filter((s) => s.sessionId).length}
        onEndSelected={endSelected}
        onEndAll={endAll}
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Live leaderboard preview</h2>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Found</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Tries</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.slice(0, 10).map((entry) => {
                const player = sessions.find((s) => s.eventPlayerId === entry.eventPlayerId);
                return (
                  <TableRow key={entry.sessionId}>
                    <TableCell>{entry.rank}</TableCell>
                    <TableCell>{player?.displayName ?? player?.mobileNumber ?? entry.eventPlayerId}</TableCell>
                    <TableCell>{entry.found ? "Yes" : "No"}</TableCell>
                    <TableCell className="font-mono">{formatMmSs(entry.cumulativeTimeMs)}</TableCell>
                    <TableCell>{entry.triesUsed}</TableCell>
                    <TableCell>{entry.tileScore}</TableCell>
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
