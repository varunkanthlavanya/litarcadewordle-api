import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EventApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackLink } from "@/components/shared/BackLink";
import { CohortUploader, type ParsedCohort } from "@/components/shared/CohortUploader";

/** Local datetime-local input values (no timezone) -> ISO string in the
 * platform's fixed event timezone-of-record is handled server-side; the
 * value posted here is treated as the wall-clock time the admin picked. */
function toIso(localDateTime: string): string | undefined {
  if (!localDateTime) return undefined;
  return new Date(localDateTime).toISOString();
}

export function EventSetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [name, setName] = useState("");
  const [roundOpensAt, setRoundOpensAt] = useState("");
  const [roundClosesAt, setRoundClosesAt] = useState("");
  const [prelimsTopN, setPrelimsTopN] = useState(20);
  const [playoffsWinnerCount, setPlayoffsWinnerCount] = useState(3);
  const [cohort, setCohort] = useState<ParsedCohort | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingFields: string[] = [];
  if (!name.trim()) missingFields.push("event name");
  if (!roundOpensAt) missingFields.push("round opens at");
  if (!roundClosesAt) missingFields.push("round closes at");
  if (!prelimsTopN) missingFields.push("prelims cutoff");
  if (!playoffsWinnerCount) missingFields.push("winner count");
  if (!cohort || cohort.players.length === 0) missingFields.push("cohort upload");
  const canProceed = missingFields.length === 0;

  async function createEvent(goLive: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      const event = await apiClient.post<EventApiRow>("/admin/events", { name });
      await apiClient.post(`/admin/events/${event.id}/config`, {
        roundOpensAt: toIso(roundOpensAt),
        roundClosesAt: toIso(roundClosesAt),
        prelimsTopN,
        playoffsWinnerCount,
      });
      if (cohort && cohort.players.length > 0) {
        await apiClient.post(`/admin/events/${event.id}/cohort`, { players: cohort.players });
      }
      if (goLive) {
        await apiClient.post(`/admin/events/${event.id}/status`, { status: "PRELIMS_SCHEDULED" });
      }
      navigate(`/admin/events/${event.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <BackLink to="/admin/events" label="Back to Events" />
      <h1 className="mb-6 text-2xl font-bold">Create Event</h1>

      {step === "form" && (
        <div className="grid gap-8 md:grid-cols-2">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground">Event details</h2>
            <div className="space-y-2">
              <Label htmlFor="name">Event name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input value="Asia/Kolkata (IST)" disabled />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="opensAt">Round opens at *</Label>
                <Input
                  id="opensAt"
                  type="datetime-local"
                  value={roundOpensAt}
                  onChange={(e) => setRoundOpensAt(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="closesAt">Round closes at *</Label>
                <Input
                  id="closesAt"
                  type="datetime-local"
                  value={roundClosesAt}
                  onChange={(e) => setRoundClosesAt(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="topN">Prelims cutoff (Top N) *</Label>
              <Input
                id="topN"
                type="number"
                min={1}
                value={prelimsTopN}
                onChange={(e) => setPrelimsTopN(Number(e.target.value))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="winners">Winner count *</Label>
              <Input
                id="winners"
                type="number"
                min={1}
                value={playoffsWinnerCount}
                onChange={(e) => setPlayoffsWinnerCount(Number(e.target.value))}
                required
              />
            </div>
          </section>

          <section className="space-y-3">
            <CohortUploader cohort={cohort} onChange={setCohort} />
          </section>

          <div className="md:col-span-2">
            {missingFields.length > 0 && (
              <p className="mb-3 text-sm text-muted-foreground">
                Still needed before you can continue: {missingFields.join(", ")}.
              </p>
            )}
            <Button disabled={!canProceed} onClick={() => setStep("confirm")}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="max-w-lg space-y-6">
          <div className="rounded-lg border bg-card p-4 text-sm">
            <dl className="space-y-2">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Event name</dt>
                <dd className="font-medium">{name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Round window</dt>
                <dd className="font-medium">
                  {new Date(roundOpensAt).toLocaleString()} → {new Date(roundClosesAt).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Prelims cutoff</dt>
                <dd className="font-medium">Top {prelimsTopN}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Winner count</dt>
                <dd className="font-medium">{playoffsWinnerCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Cohort</dt>
                <dd className="font-medium">{cohort?.players.length ?? 0} players</dd>
              </div>
            </dl>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setStep("form")} disabled={submitting}>
              Back to edit
            </Button>
            <Button variant="outline" onClick={() => createEvent(false)} disabled={submitting}>
              {submitting ? "Saving..." : "Save as Draft"}
            </Button>
            <Button onClick={() => createEvent(true)} disabled={submitting}>
              {submitting ? "Publishing..." : "Go Live"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Everything here — including the cohort — can still be edited later from the event's control center,
            whether it's saved as a draft or already live.
          </p>
        </div>
      )}
    </div>
  );
}
