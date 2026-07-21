import { useEffect, useState } from "react";
import type { TileColor, UnwordleBankPuzzleDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WordleTile } from "@/components/shared/WordleTile";

interface RowValidation {
  rowIndex: number;
  satisfiable: boolean;
  sampleWords: string[];
}
type ValidationResult = { valid: boolean; rowResults: RowValidation[] };

const NEXT_COLOR: Record<TileColor, TileColor> = { GRAY: "YELLOW", YELLOW: "GREEN", GREEN: "GRAY" };
const ROWS_PER_PUZZLE = 4;

function emptyPatterns(): TileColor[][] {
  return Array.from({ length: ROWS_PER_PUZZLE }, () => Array<TileColor>(5).fill("GRAY"));
}

function nextFreeSlot(existingPuzzles: UnwordleBankPuzzleDto[], bankSize: number): number {
  const taken = new Set(existingPuzzles.map((p) => p.puzzleNumber));
  for (let n = 1; n <= bankSize; n++) {
    if (!taken.has(n)) return n;
  }
  return bankSize;
}

/** Manual single-puzzle authoring — the tile-clicking alternative to bulk
 * Excel upload, for an admin who'd rather build each puzzle by hand (or fix
 * one specific slot flagged wrong in the preview grid) than prepare a
 * spreadsheet. Targets whichever puzzle number is selected: loads that
 * slot's existing solution/pattern for editing if one's already banked
 * there, otherwise starts blank for a fresh add. Saving always forces the
 * puzzle back to DRAFT (never silently stays PUBLISHED from a stale prior
 * save), same rule the bulk uploader follows. */
export function UnwordleManualPuzzleForm({
  eventId,
  bankSize,
  existingPuzzles,
  onSaved,
}: {
  eventId: number;
  bankSize: number;
  existingPuzzles: UnwordleBankPuzzleDto[];
  onSaved: () => void;
}) {
  const [puzzleNumber, setPuzzleNumber] = useState(() => nextFreeSlot(existingPuzzles, bankSize));
  const [solutionWord, setSolutionWord] = useState("");
  const [patterns, setPatterns] = useState<TileColor[][]>(emptyPatterns());
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const existingAtSlot = existingPuzzles.find((p) => p.puzzleNumber === puzzleNumber) ?? null;

  // Loading a different puzzle number pulls in whatever's already banked
  // there (so re-selecting a filled slot edits it in place) or resets to a
  // blank form for an empty slot.
  useEffect(() => {
    if (existingAtSlot) {
      setSolutionWord(existingAtSlot.solutionWord);
      setPatterns(existingAtSlot.rowPatterns.map((row) => [...row]));
    } else {
      setSolutionWord("");
      setPatterns(emptyPatterns());
    }
    setValidation(null);
    setError(null);
    setSavedMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleNumber]);

  function cycleTile(row: number, col: number) {
    setPatterns((prev) => {
      const next = prev.map((r) => [...r]);
      next[row][col] = NEXT_COLOR[next[row][col]];
      return next;
    });
    setValidation(null);
    setSavedMessage(null);
  }

  async function handleValidate() {
    setError(null);
    try {
      const res = await apiClient.post<ValidationResult>(`/admin/events/${eventId}/unwordle/puzzle/validate`, {
        solutionWord,
        rowPatterns: patterns,
      });
      setValidation(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not validate");
    }
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    setSavedMessage(null);
    try {
      await apiClient.post(`/admin/events/${eventId}/unwordle/puzzle`, { solutionWord, rowPatterns: patterns, puzzleNumber });
      setSavedMessage(`Puzzle ${puzzleNumber} saved.`);
      onSaved();
      // Jump to the next open slot so authoring the whole bank by hand is a
      // quick save-save-save loop rather than re-picking a number each time.
      const taken = new Set([...existingPuzzles.map((p) => p.puzzleNumber), puzzleNumber]);
      let next = puzzleNumber + 1;
      while (next <= bankSize && taken.has(next)) next++;
      if (next <= bankSize) setPuzzleNumber(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save puzzle");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="manualPuzzleNumber">Puzzle #</Label>
          <Input
            id="manualPuzzleNumber"
            type="number"
            min={1}
            max={bankSize}
            className="w-20"
            value={puzzleNumber}
            onChange={(e) => setPuzzleNumber(Math.min(bankSize, Math.max(1, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="manualSolution">Solution</Label>
          <Input
            id="manualSolution"
            value={solutionWord}
            onChange={(e) => {
              setSolutionWord(e.target.value.toUpperCase());
              setValidation(null);
              setSavedMessage(null);
            }}
            maxLength={5}
            className="w-32 font-mono uppercase"
          />
        </div>
        <Button variant="outline" onClick={handleValidate} disabled={solutionWord.length !== 5}>
          Validate
        </Button>
        <Button onClick={handleSave} disabled={submitting || solutionWord.length !== 5 || !validation?.valid}>
          {submitting ? "Saving..." : existingAtSlot ? "Save changes" : "Add to bank"}
        </Button>
        {existingAtSlot && (
          <span className="text-xs text-muted-foreground">Editing an already-banked puzzle — saving resets it to DRAFT.</span>
        )}
      </div>

      <div className="space-y-1.5">
        {patterns.map((pattern, i) => {
          const rowResult = validation?.rowResults.find((r) => r.rowIndex === i);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
              <div className="flex gap-1">
                {pattern.map((color, j) => (
                  <button key={j} type="button" onClick={() => cycleTile(i, j)}>
                    <WordleTile size="sm" state="pattern" patternColor={color} />
                  </button>
                ))}
              </div>
              {rowResult && (
                <span className={rowResult.satisfiable ? "text-xs text-success" : "text-xs font-semibold text-destructive"}>
                  {rowResult.satisfiable ? `✓ e.g. ${rowResult.sampleWords.join(", ")}` : "✕ no valid dictionary word matches this pattern"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Click a tile to cycle gray → yellow → green.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {savedMessage && <p className="text-sm text-success">{savedMessage}</p>}
    </div>
  );
}
