import { useCallback, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ParsedCohort {
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

/** Drag-drop CSV cohort uploader — used both at event creation and for editing
 * an existing event's cohort later. Re-uploading is safe at any point: the
 * backend upserts by (event_id, mobile_number), so it adds new players and
 * updates display names for existing ones without ever wiping the cohort. */
export function CohortUploader({
  cohort,
  onChange,
  existingCount,
}: {
  cohort: ParsedCohort | null;
  onChange: (cohort: ParsedCohort) => void;
  existingCount?: number;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      file.text().then((text) => onChange(parseCsv(text)));
    },
    [onChange]
  );

  return (
    <div className="space-y-3">
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
        {typeof existingCount === "number" && existingCount > 0 && (
          <span className="text-xs">
            {existingCount} player{existingCount === 1 ? "" : "s"} already in this cohort — uploading adds new
            numbers and updates names for existing ones, nothing is removed.
          </span>
        )}
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
    </div>
  );
}
