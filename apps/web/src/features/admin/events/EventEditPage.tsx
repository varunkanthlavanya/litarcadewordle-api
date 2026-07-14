import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { EventApiRow, EventPlayerApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackLink } from "@/components/shared/BackLink";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { CohortUploader, type ParsedCohort } from "@/components/shared/CohortUploader";

const EVENT_STATUS_MAP: Record<string, StatusBadgeStatus> = {
  DRAFT: "draft",
  COHORT_UPLOADED: "cohortUploaded",
  PRELIMS_SCHEDULED: "prelimsScheduled",
  PRELIMS_LIVE: "prelimsLive",
  PRELIMS_CLOSED: "prelimsClosed",
  PLAYOFFS_SCHEDULED: "playoffsScheduled",
  PLAYOFFS_LIVE: "playoffsLive",
  PLAYOFFS_CLOSED: "playoffsClosed",
  ARCHIVED: "archived",
};

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

function statusBadgeFor(status: string): StatusBadgeStatus {
  return EVENT_STATUS_MAP[status] ?? "draft";
}

export function EventEditPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventApiRow | null>(null);
  const [name, setName] = useState("");
  const [roundOpensAt, setRoundOpensAt] = useState("");
  const [roundClosesAt, setRoundClosesAt] = useState("");
  const [prelimsTopN, setPrelimsTopN] = useState(20);
  const [playoffsWinnerCount, setPlayoffsWinnerCount] = useState(3);
  const [existingCohortCount, setExistingCohortCount] = useState(0);
  const [newCohort, setNewCohort] = useState<ParsedCohort | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<EventApiRow>(`/admin/events/${eventId}`).then((e) => {
      setEvent(e);
      setName(e.name);
      setRoundOpensAt(toLocalInputValue(e.round_opens_at));
      setRoundClosesAt(toLocalInputValue(e.round_closes_at));
      setPrelimsTopN(e.prelims_top_n ?? 20);
      setPlayoffsWinnerCount(e.playoffs_winner_count ?? 3);
    });
    apiClient.get<EventPlayerApiRow[]>(`/admin/events/${eventId}/cohort`).then((c) => setExistingCohortCount(c.length));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  async function setLive(goLive: boolean) {
    if (!event) return;
    setSaving(true);
    setError(null);
    try {
      const status = goLive ? "PRELIMS_SCHEDULED" : "DRAFT";
      const updated = await apiClient.post<EventApiRow>(`/admin/events/${eventId}/status`, { status });
      setEvent(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change event status");
    } finally {
      setSaving(false);
    }
  }

  if (!event) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div>
      <BackLink to={`/admin/events/${eventId}`} label="Back to Event Control Center" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Edit Event</h1>
        <StatusBadge status={statusBadgeFor(event.status)} />
      </div>

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
            <div className="flex gap-3">
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
          </div>
        </div>
      </div>
    </div>
  );
}
