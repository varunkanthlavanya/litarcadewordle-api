import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import type { EventApiRow, EventPlayerApiRow, EventWinnerApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CohortUploader, type ParsedCohort } from "@/components/shared/CohortUploader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { EventWorkspaceContext } from "./EventWorkspaceLayout";

function toIso(localDateTime: string): string | undefined {
  if (!localDateTime) return undefined;
  return new Date(localDateTime).toISOString();
}

/** ISO timestamp -> the value a <input type="datetime-local"> expects
 * (local wall-clock, no timezone/seconds suffix). */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const isLiveStatus = (status: string) => status !== "DRAFT";

export function EventEditPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { event, reload } = useOutletContext<EventWorkspaceContext>();

  const [name, setName] = useState("");
  const [roundOpensAt, setRoundOpensAt] = useState("");
  const [roundClosesAt, setRoundClosesAt] = useState("");
  const [prelimsTopN, setPrelimsTopN] = useState(20);
  const [playoffsWinnerCount, setPlayoffsWinnerCount] = useState(3);
  const [existingCohortCount, setExistingCohortCount] = useState(0);
  const [newCohort, setNewCohort] = useState<ParsedCohort | null>(null);
  const [winnersCount, setWinnersCount] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(event.name);
    setRoundOpensAt(toLocalInputValue(event.round_opens_at));
    setRoundClosesAt(toLocalInputValue(event.round_closes_at));
    setPrelimsTopN(event.prelims_top_n ?? 20);
    setPlayoffsWinnerCount(event.playoffs_winner_count ?? 3);
  }, [event]);

  useEffect(() => {
    apiClient.get<EventPlayerApiRow[]>(`/admin/events/${eventId}/cohort`).then((c) => setExistingCohortCount(c.length));
    apiClient.get<EventWinnerApiRow[]>(`/admin/events/${eventId}/winners`).then((w) => setWinnersCount(w.length));
  }, [eventId]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiClient.post(`/admin/events/${eventId}/config`, {
        roundOpensAt: toIso(roundOpensAt),
        roundClosesAt: toIso(roundClosesAt),
        prelimsTopN,
        playoffsWinnerCount,
      });
      if (newCohort && newCohort.players.length > 0) {
        const res = await apiClient.post<{ count: number }>(`/admin/events/${eventId}/cohort`, { players: newCohort.players });
        setExistingCohortCount(res.count);
        setNewCohort(null);
      }
      setSaved(true);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  async function setLive(goLive: boolean) {
    setSaving(true);
    setError(null);
    try {
      const status = goLive ? "PRELIMS_SCHEDULED" : "DRAFT";
      await apiClient.post<EventApiRow>(`/admin/events/${eventId}/status`, { status });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change event status");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post<EventApiRow>(`/admin/events/${eventId}/status`, { status: "ARCHIVED" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Cohort & Settings</h1>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Event details</h2>
          <div className="space-y-2">
            <Label htmlFor="name">Event name</Label>
            <Input id="name" value={name} disabled />
            <p className="text-xs text-muted-foreground">Name is set at creation and can't be changed here.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="opensAt">Round opens at</Label>
              <Input id="opensAt" type="datetime-local" value={roundOpensAt} onChange={(e) => setRoundOpensAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="closesAt">Round closes at</Label>
              <Input id="closesAt" type="datetime-local" value={roundClosesAt} onChange={(e) => setRoundClosesAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="topN">Prelims cutoff (Top N)</Label>
            <Input id="topN" type="number" min={1} value={prelimsTopN} onChange={(e) => setPrelimsTopN(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="winners">Winner count</Label>
            <Input id="winners" type="number" min={1} value={playoffsWinnerCount} onChange={(e) => setPlayoffsWinnerCount(Number(e.target.value))} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Cohort ({existingCohortCount} players)</h2>
          <CohortUploader cohort={newCohort} onChange={setNewCohort} existingCount={existingCohortCount} />
        </section>

        <div className="md:col-span-2 space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-success">Saved.</p>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>

          <div className="rounded-lg border bg-card p-4">
            <p className="mb-3 text-sm font-medium">Event status</p>
            {event.status === "ARCHIVED" ? (
              <p className="text-sm text-muted-foreground">
                This event is archived — winners have been announced and it's closed for further changes.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant={event.status === "DRAFT" ? "default" : "outline"}
                  disabled={saving || event.status === "DRAFT"}
                  onClick={() => setLive(false)}
                >
                  Move to Draft
                </Button>
                <Button
                  variant={isLiveStatus(event.status) ? "default" : "outline"}
                  disabled={saving || isLiveStatus(event.status)}
                  onClick={() => setLive(true)}
                >
                  Go Live
                </Button>
              </div>
            )}
          </div>

          {event.status !== "ARCHIVED" && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
              <p className="mb-1 text-sm font-medium">Archive event</p>
              <p className="mb-3 text-xs text-muted-foreground">
                {winnersCount > 0
                  ? "Winners have been announced — this event is ready to archive."
                  : "Unlocks once winners are saved on the Winners tab."}
              </p>
              <Button variant="outline" disabled={saving || winnersCount === 0} onClick={() => setArchiveOpen(true)}>
                Archive Event
              </Button>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          title={`Archive "${event.name}"?`}
          description="This marks the event closed for good — cohort, schedule, and status can no longer be changed. Player and game data stays intact. Continue?"
          confirmLabel="Archive Event"
          destructive={false}
          onConfirm={handleArchive}
        />
      </div>
    </div>
  );
}
