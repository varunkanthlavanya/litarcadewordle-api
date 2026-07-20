import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { CutoffPreviewRow, EventPlayerApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { formatMmSs } from "@/hooks/useCountdown";
import { cn } from "@/lib/utils";
import type { EventWorkspaceContext } from "../events/EventWorkspaceLayout";

export function CutoffToolPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { event } = useOutletContext<EventWorkspaceContext>();
  // Default to whatever "Prelims cutoff (Top N)" was configured for this
  // event, not a hardcoded 20 — a cohort of 10 finishers defaulting to a
  // stale/generic 20 silently includes everyone, which read as "the
  // exclude/topN controls don't work" even though they did exactly what
  // was asked (just not what the admin was expecting to be pre-filled).
  const [topN, setTopN] = useState(event.prelims_top_n ?? 20);
  const [preview, setPreview] = useState<CutoffPreviewRow[] | null>(null);
  const [cohort, setCohort] = useState<EventPlayerApiRow[]>([]);
  const [manualAdd, setManualAdd] = useState<Set<number>>(new Set());
  const [manualRemove, setManualRemove] = useState<Set<number>>(new Set());
  const [seeded, setSeeded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<EventPlayerApiRow[]>(`/admin/events/${eventId}/cohort`).then(setCohort);
  }, [eventId]);

  useEffect(() => {
    apiClient
      .get<CutoffPreviewRow[]>(`/admin/events/${eventId}/cutoff/preview?topN=${topN}`)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load preview"));
  }, [eventId, topN]);

  // One-time seed (per page visit) from what's actually already been
  // confirmed in the DB — so a player advanced earlier via a manual
  // "+ include" (or a since-changed Top N) still shows as included when the
  // admin comes back to this tab, instead of the selection silently
  // resetting to a fresh rank<=topN guess every time.
  useEffect(() => {
    if (!preview || seeded) return;
    const add = new Set<number>();
    preview.forEach((r) => {
      if (r.advancedToPlayoffs && !r.withinCutoff) add.add(r.eventPlayerId);
    });
    setManualAdd(add);
    setSeeded(true);
  }, [preview, seeded]);

  const playerName = (id: number) => {
    const p = cohort.find((c) => c.id === id);
    return p?.display_name ?? p?.mobile_number ?? `Player ${id}`;
  };

  const advancingIds = useMemo(() => {
    if (!preview) return new Set<number>();
    const set = new Set(preview.filter((r) => r.withinCutoff && !manualRemove.has(r.eventPlayerId)).map((r) => r.eventPlayerId));
    manualAdd.forEach((id) => set.add(id));
    return set;
  }, [preview, manualAdd, manualRemove]);

  async function handleConfirm() {
    try {
      await apiClient.post(`/admin/events/${eventId}/cutoff/confirm`, { eventPlayerIds: [...advancingIds] });
      // Land on the Playoffs tab, not back at Overview — advancing players is
      // always immediately followed by setting up/monitoring their UNWORDLE
      // round, so that's the natural next stop, not a hub round-trip.
      navigate(`/admin/events/${eventId}/playoffs`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not advance players");
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Cutoff Tool</h1>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="topN">Advance top</Label>
            <Input
              id="topN"
              type="number"
              min={5}
              max={50}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <span className="pb-2 text-sm text-muted-foreground">of {preview?.length ?? 0} players</span>
        </div>
        <Button size="lg" onClick={() => setConfirmOpen(true)} disabled={advancingIds.size === 0}>
          Advance to Playoffs — {advancingIds.size} players
        </Button>
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Found</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Tries</TableHead>
              <TableHead>Score</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview?.map((row, i) => {
              const isCutoffLine = i > 0 && preview[i - 1].withinCutoff && !row.withinCutoff;
              const included = advancingIds.has(row.eventPlayerId);
              const borderlineIncluded = !row.withinCutoff && manualAdd.has(row.eventPlayerId);
              return (
                <Fragment key={row.sessionId}>
                  {isCutoffLine && (
                    <TableRow key={`cutoff-${row.sessionId}`}>
                      <TableCell colSpan={7} className="border-y-2 border-dashed border-primary bg-accent/10 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-primary">
                        Cutoff · Top {topN}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow key={row.sessionId} className={cn(!included && "opacity-60")}>
                    <TableCell>{row.rank}</TableCell>
                    <TableCell>
                      {playerName(row.eventPlayerId)}
                      {borderlineIncluded && (
                        <span className="ml-2 text-xs text-muted-foreground">(manually included)</span>
                      )}
                    </TableCell>
                    <TableCell>{row.found ? "Yes" : "No"}</TableCell>
                    <TableCell className="font-mono">{formatMmSs(row.cumulativeTimeMs)}</TableCell>
                    <TableCell>{row.triesUsed}</TableCell>
                    <TableCell>{row.tileScore}</TableCell>
                    <TableCell>
                      {!row.withinCutoff && (
                        <button
                          className={cn(
                            "text-xs font-medium hover:underline",
                            manualAdd.has(row.eventPlayerId) ? "text-destructive" : "text-primary"
                          )}
                          onClick={() =>
                            setManualAdd((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.eventPlayerId)) next.delete(row.eventPlayerId);
                              else next.add(row.eventPlayerId);
                              return next;
                            })
                          }
                        >
                          {manualAdd.has(row.eventPlayerId) ? "− remove" : "+ include"}
                        </button>
                      )}
                      {row.withinCutoff && (
                        <button
                          className="text-xs font-medium text-destructive hover:underline"
                          onClick={() =>
                            setManualRemove((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.eventPlayerId)) next.delete(row.eventPlayerId);
                              else next.add(row.eventPlayerId);
                              return next;
                            })
                          }
                        >
                          {manualRemove.has(row.eventPlayerId) ? "+ re-include" : "− exclude"}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Advance players to Playoffs?"
        description={`This will advance ${advancingIds.size} player${advancingIds.size === 1 ? "" : "s"} to the UNWORDLE Playoffs round and notify them. Continue?`}
        confirmLabel="Advance"
        destructive={false}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
