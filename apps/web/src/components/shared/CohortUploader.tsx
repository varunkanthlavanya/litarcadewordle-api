import { useCallback, useState } from "react";
import { UploadCloud, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ParsedCohort {
  players: Array<{ mobileNumber: string; displayName?: string }>;
  duplicateLines: Array<{ line: number; value: string }>;
  invalidLines: Array<{ line: number; value: string }>;
}

// Same normalization rule as the backend (wl-events cohort upload, wl-player-auth
// login): strip everything but digits, keep the last 10 — so "+91 8220 850 225"
// becomes "8220850225" regardless of prefix or spacing.
function normalizeMobileNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function parseRows(rows: Array<Array<string | number | undefined>>): ParsedCohort {
  const first = rows[0]?.map((c) => String(c ?? "").trim().toLowerCase());
  const startIndex = first && first[0]?.startsWith("mobile_number") ? 1 : 0;
  const seen = new Set<string>();
  const duplicateLines: ParsedCohort["duplicateLines"] = [];
  const invalidLines: ParsedCohort["invalidLines"] = [];
  const players: ParsedCohort["players"] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rawMobileNumber = String(row[0] ?? "").trim();
    const displayName = String(row[1] ?? "").trim();
    if (!rawMobileNumber) continue;
    const mobileNumber = normalizeMobileNumber(rawMobileNumber);
    if (mobileNumber.length !== 10) {
      invalidLines.push({ line: i + 1, value: rawMobileNumber });
      continue;
    }
    if (seen.has(mobileNumber)) {
      duplicateLines.push({ line: i + 1, value: rawMobileNumber });
      continue;
    }
    seen.add(mobileNumber);
    players.push({ mobileNumber, displayName: displayName || undefined });
  }

  return { players, duplicateLines, invalidLines };
}

async function parseFile(file: File): Promise<ParsedCohort> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Array<string | number | undefined>>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  return parseRows(rows);
}

function downloadSampleXlsx() {
  const data = [
    ["mobile_number", "display_name"],
    ["9876543210", "Alice"],
    ["9123456780", "Bob"],
    ["9012345678", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 18 }, { wch: 22 }];
  // Force mobile_number column as text to preserve leading digits
  for (let r = 1; r < data.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell) {
      cell.t = "s";
      cell.v = String(cell.v);
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cohort");
  XLSX.writeFile(wb, "cohort-sample.xlsx");
}

/** Drag-drop Excel/CSV cohort uploader — used both at event creation and for
 * editing an existing event's cohort later. Re-uploading is safe at any
 * point: the backend upserts by (event_id, mobile_number), so it adds new
 * players and updates display names for existing ones without ever wiping
 * the cohort. */
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
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      parseFile(file)
        .then(onChange)
        .catch(() => setError("Could not read file. Use the sample .xlsx as a template."));
    },
    [onChange]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Cohort upload</span>
        <Button type="button" variant="outline" size="sm" onClick={downloadSampleXlsx}>
          <Download className="mr-2 h-4 w-4" />
          Sample .xlsx
        </Button>
      </div>

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
        <span>Drop Excel (.xlsx) or CSV here — columns: mobile_number, display_name (optional) · max 600 rows</span>
        {typeof existingCount === "number" && existingCount > 0 && (
          <span className="text-xs">
            {existingCount} player{existingCount === 1 ? "" : "s"} already in this cohort — uploading adds new
            numbers and updates names for existing ones, nothing is removed.
          </span>
        )}
        <input
          type="file"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {cohort && (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md border bg-success-subtle px-3 py-2 text-sm text-success">
            <span>✓ Cohort parsed</span>
            <span className="font-mono">
              Total players: <strong>{cohort.players.length}</strong>
              {cohort.duplicateLines.length > 0 &&
                ` · ${cohort.duplicateLines.length} duplicate${cohort.duplicateLines.length === 1 ? "" : "s"} skipped`}
              {cohort.invalidLines.length > 0 &&
                ` · ${cohort.invalidLines.length} invalid number${cohort.invalidLines.length === 1 ? "" : "s"} skipped`}
            </span>
          </div>
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Mobile number</th>
                  <th className="px-3 py-2 text-left">Display name</th>
                </tr>
              </thead>
              <tbody>
                {cohort.players.map((p, idx) => (
                  <tr key={p.mobileNumber} className="border-t">
                    <td className="px-3 py-1.5 text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-1.5 font-mono">{p.mobileNumber}</td>
                    <td className="px-3 py-1.5">{p.displayName ?? <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cohort.duplicateLines.length > 0 && (
            <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
              {cohort.duplicateLines.map((d) => (
                <li key={d.line}>
                  Row {d.line}: {d.value} — duplicate, skipped
                </li>
              ))}
            </ul>
          )}
          {cohort.invalidLines.length > 0 && (
            <ul className="space-y-0.5 font-mono text-xs text-destructive">
              {cohort.invalidLines.map((d) => (
                <li key={d.line}>
                  Row {d.line}: {d.value} — not a valid 10-digit mobile number, skipped
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
