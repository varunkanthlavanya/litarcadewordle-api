import { useCallback, useState } from "react";
import { UploadCloud, Download } from "lucide-react";
import * as XLSX from "xlsx";
import type { TileColor, UnwordleBulkUploadResult } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ParsedPuzzleRow {
  puzzleNumber: number;
  solutionWord: string;
  rowPatterns: TileColor[][];
}

function parseRows(rows: Array<Array<string | number | undefined>>): ParsedPuzzleRow[] {
  const first = rows[0]?.map((c) => String(c ?? "").trim().toLowerCase());
  const startIndex = first && first[0]?.startsWith("puzzle_number") ? 1 : 0;
  const puzzles: ParsedPuzzleRow[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row[0] === undefined || row[0] === "") continue; // skip fully blank rows
    const puzzleNumber = Number(row[0]);
    const solutionWord = String(row[1] ?? "").trim().toUpperCase();
    const rowPatterns = [2, 3, 4, 5].map(
      (col) =>
        String(row[col] ?? "")
          .split(",")
          .map((c) => c.trim().toUpperCase()) as TileColor[]
    );
    puzzles.push({ puzzleNumber, solutionWord, rowPatterns });
  }

  return puzzles;
}

async function parseFile(file: File): Promise<ParsedPuzzleRow[]> {
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

// One fully worked, dictionary-valid example row — hand-verified against the
// actual VALID_GUESS_WORDS list (CRANE/TRACE/CRONE/GRAND all confirmed
// present) rather than guessed, since a broken sample template would
// immediately confuse whoever downloads it. Confirmed required deliverable
// per PRD Rev 3 §12 Decisions Log #4.
function downloadSampleXlsx() {
  const data: Array<Array<string | number>> = [
    ["puzzle_number", "solution_word", "row_1_pattern", "row_2_pattern", "row_3_pattern", "row_4_pattern"],
    [
      1,
      "CRANE",
      "GRAY,GREEN,GREEN,YELLOW,GREEN", // satisfied by TRACE
      "GREEN,GREEN,GRAY,GREEN,GREEN", // satisfied by CRONE
      "GRAY,GREEN,GREEN,GREEN,GRAY", // satisfied by GRAND
      "GREEN,GREEN,GREEN,GREEN,GREEN", // freebie reference row (CRANE itself)
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 30 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Puzzle Bank");
  XLSX.writeFile(wb, "unwordle-bank-sample.xlsx");
}

/** Bulk Excel puzzle-bank uploader — mirrors CohortUploader.tsx's structure
 * (drop zone, sample download, error list) closely, but NOT its skip-and-
 * continue semantics: a puzzle bank upload is all-or-nothing (PRD §3.3) —
 * any invalid row means nothing gets saved, not "the good rows go through
 * and the bad ones are skipped" like cohort rows are. The server is the
 * single source of truth for validation (dictionary satisfiability can only
 * be checked there); this component just parses the sheet and reports
 * whatever the server says. */
export function UnwordleBankUploader({
  eventId,
  onUploaded,
}: {
  eventId: number;
  onUploaded: (result: UnwordleBulkUploadResult) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<UnwordleBulkUploadResult | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      setUploading(true);
      parseFile(file)
        .then((puzzles) => apiClient.post<UnwordleBulkUploadResult>(`/admin/events/${eventId}/unwordle/bank/upload`, { puzzles }))
        .then((result) => {
          setLastResult(result);
          onUploaded(result);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Could not read or upload file. Use the sample .xlsx as a template."))
        .finally(() => setUploading(false));
    },
    [eventId, onUploaded]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Puzzle bank upload</span>
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
        <span>
          Drop Excel (.xlsx) or CSV here — columns: puzzle_number, solution_word, row_1_pattern..row_4_pattern
          (each a comma-separated GREEN/YELLOW/GRAY per tile)
        </span>
        <span className="text-xs">
          All-or-nothing: if any row is invalid, nothing is saved — fix and re-upload the whole sheet, or just the
          affected puzzle numbers.
        </span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>

      {uploading && <p className="text-sm text-muted-foreground">Validating against the dictionary…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {lastResult && lastResult.errors.length === 0 && lastResult.accepted.length > 0 && (
        <div className="rounded-md border bg-success-subtle px-3 py-2 text-sm text-success">
          ✓ {lastResult.accepted.length} puzzle{lastResult.accepted.length === 1 ? "" : "s"} banked — now{" "}
          {lastResult.bankedCount} / {lastResult.bankSize} total
        </div>
      )}

      {lastResult && lastResult.errors.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-destructive">
            {lastResult.errors.length} problem{lastResult.errors.length === 1 ? "" : "s"} found — nothing was saved:
          </p>
          <ul className="max-h-64 space-y-0.5 overflow-auto rounded-md border bg-destructive/5 p-3 font-mono text-xs text-destructive">
            {lastResult.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
