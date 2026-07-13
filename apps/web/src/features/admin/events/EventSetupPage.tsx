import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadCloud } from "lucide-react";
import type { EventApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackLink } from "@/components/shared/BackLink";
import { cn } from "@/lib/utils";

interface ParsedCohort {
  players: Array<{ mobileNumber: string; displayName?: string }>;
  duplicateLines: Array<{ line: number; value: string }>;
}

function parseCsv(text: string): ParsedCohort {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const startIndex = lines[0]?.toLowerCase().startsWith("mobile_number") ? 1 : 0;
  const seen = new Set<string>();
  const duplicateLines: ParsedCohort["duplicateLines"] = [];
  const players: ParsedCohort["players"] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const [mobileNumber, displayName] = lines[i].split(",").map((c) => c?.trim());
    if (!mobileNumber) continue;
    if (seen.has(mobileNumber)) {
      duplicateLines.push({ line: i + 1, value: mobileNumber });
      continue;
    }
    seen.add(mobileNumber);
    players.push({ mobileNumber, displayName: displayName || undefined });
  }

  return { players, duplicateLines };
}

export function EventSetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [prelimsTopN, setPrelimsTopN] = useState(20);
  const [playoffsWinnerCount, setPlayoffsWinnerCount] = useState(3);
  const [cohort, setCohort] = useState<ParsedCohort | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    file.text().then((text) => setCohort(parseCsv(text)));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const event = await apiClient.post<EventApiRow>("/admin/events", { name });
      await apiClient.post(`/admin/events/${event.id}/config`, { prelimsTopN, playoffsWinnerCount });
      if (cohort && cohort.players.length > 0) {
        await apiClient.post(`/admin/events/${event.id}/cohort`, { players: cohort.players });
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
      <form onSubmit={handleSubmit} className="grid gap-8 md:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Event details</h2>
          <div className="space-y-2">
            <Label htmlFor="name">Event name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Input value="Asia/Kolkata (IST)" disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="topN">Prelims cutoff (Top N)</Label>
            <Input
              id="topN"
              type="number"
              min={5}
              max={50}
              value={prelimsTopN}
              onChange={(e) => setPrelimsTopN(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="winners">Winner count</Label>
            <Input
              id="winners"
              type="number"
              min={3}
              max={5}
              value={playoffsWinnerCount}
              onChange={(e) => setPlayoffsWinnerCount(Number(e.target.value))}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Cohort upload</h2>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground transition-colors",
              dragOver ? "border-primary bg-accent/10" : "border-border"
            )}
          >
            <UploadCloud className="h-6 w-6" />
            <span>Drop CSV here — columns: mobile_number, display_name (optional) · max 600 rows</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>

          {cohort && (
            <div className="rounded-md border bg-success-subtle p-3 text-sm text-success">
              ✓ {cohort.players.length} players uploaded
              {cohort.duplicateLines.length > 0 && ` · ${cohort.duplicateLines.length} duplicates skipped`}
              {cohort.duplicateLines.length > 0 && (
                <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
                  {cohort.duplicateLines.map((d) => (
                    <li key={d.line}>
                      Line {d.line}: {d.value} — duplicate, skipped
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <div className="md:col-span-2">
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting || !name}>
            {submitting ? "Creating..." : "Create Event"}
          </Button>
        </div>
      </form>
    </div>
  );
}
