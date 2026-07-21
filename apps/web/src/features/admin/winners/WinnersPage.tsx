import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { EventPlayerApiRow, EventWinnerApiRow, UnwordleLeaderboardEntry } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const WINNER_COUNT = 5;
const PLACE_LABELS: Record<number, string> = { 1: "🥇 1st place", 2: "2nd place", 3: "3rd place", 4: "4th place", 5: "5th place" };

export function WinnersPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [leaderboard, setLeaderboard] = useState<UnwordleLeaderboardEntry[]>([]);
  const [cohort, setCohort] = useState<EventPlayerApiRow[]>([]);
  const [places, setPlaces] = useState<Record<number, number | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient.get<UnwordleLeaderboardEntry[]>(`/admin/events/${eventId}/unwordle/leaderboard`).then(setLeaderboard);
    apiClient.get<EventPlayerApiRow[]>(`/admin/events/${eventId}/cohort`).then(setCohort);
    apiClient.get<EventWinnerApiRow[]>(`/admin/events/${eventId}/winners`).then((rows) => {
      const map: Record<number, number> = {};
      rows.forEach((r) => (map[r.event_player_id] = r.place));
      setPlaces(map);
    });
  }, [eventId]);

  const playerName = (id: number) => {
    const p = cohort.find((c) => c.id === id);
    return p?.display_name ?? p?.mobile_number ?? `Player ${id}`;
  };

  async function handleSave() {
    setSaving(true);
    try {
      const winners = Object.entries(places)
        .filter(([, place]) => place !== undefined)
        .map(([eventPlayerId, place]) => ({ eventPlayerId: Number(eventPlayerId), place: place! }));
      await apiClient.post(`/admin/events/${eventId}/winners`, { winners });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const rows = leaderboard.map((e) => [e.rank, playerName(e.eventPlayerId), e.totalPoints, e.totalPuzzlesCompleted, places[e.eventPlayerId] ?? ""]);
    const csv = ["rank,player,points,puzzles_completed,place", ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `event-${eventId}-winners.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Winners</h1>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>Puzzles completed</TableHead>
              <TableHead>Place</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboard.map((entry) => {
              const place = places[entry.eventPlayerId];
              return (
                <TableRow key={entry.eventPlayerId} className={cn(place === 1 && "bg-accent/15")}>
                  <TableCell>{entry.rank}</TableCell>
                  <TableCell>{playerName(entry.eventPlayerId)}</TableCell>
                  <TableCell className="font-mono">{entry.totalPoints}</TableCell>
                  <TableCell>{entry.totalPuzzlesCompleted}</TableCell>
                  <TableCell>
                    <Select
                      value={place ? String(place) : "none"}
                      onValueChange={(v) =>
                        setPlaces((prev) => ({ ...prev, [entry.eventPlayerId]: v === "none" ? undefined : Number(v) }))
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {Array.from({ length: WINNER_COUNT }, (_, i) => i + 1).map((p) => (
                          <SelectItem key={p} value={String(p)}>
                            {PLACE_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={handleExport}>
          Export summary
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : saved ? "Saved ✓" : "Save winners"}
        </Button>
      </div>
    </div>
  );
}
