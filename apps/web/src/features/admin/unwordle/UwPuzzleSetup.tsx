import { useEffect, useState } from "react";
import type { TileColor } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WordleTile } from "@/components/shared/WordleTile";
import { Badge } from "@/components/ui/badge";

interface UwPuzzleSetupProps {
  eventId: number;
  puzzle: { solution_word: string; row_patterns: TileColor[][]; status: "DRAFT" | "PUBLISHED" } | null;
  onChanged: () => void;
  /** True once at least one player has an UNWORDLE session for this event —
   * shown as a caution while editing, since changing the solution/patterns
   * after players have already started (or finished) changes what they're
   * solving retroactively. */
  hasSessions?: boolean;
}

interface RowValidation {
  rowIndex: number;
  satisfiable: boolean;
  sampleWords: string[];
}
type ValidationResult = { valid: boolean; rowResults: RowValidation[] };

const NEXT_COLOR: Record<TileColor, TileColor> = { GRAY: "YELLOW", YELLOW: "GREEN", GREEN: "GRAY" };

function emptyPatterns(): TileColor[][] {
  return Array.from({ length: 4 }, () => Array<TileColor>(5).fill("GRAY"));
}

export function UwPuzzleSetup({ eventId, puzzle, onChanged, hasSessions }: UwPuzzleSetupProps) {
  const [editing, setEditing] = useState(false);
  const [solutionWord, setSolutionWord] = useState("");
  const [patterns, setPatterns] = useState<TileColor[][]>(emptyPatterns());
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The saved-puzzle view previously just labeled every row "✓ satisfiable"
  // unconditionally — actually check it against the real dictionary, the
  // same way the editing form's own "Validate" button does, so a genuinely
  // unsatisfiable pattern (impossible to reach with any real word) shows up
  // as broken instead of being rubber-stamped.
  const [savedValidation, setSavedValidation] = useState<ValidationResult | null>(null);
  const [savedValidationError, setSavedValidationError] = useState<string | null>(null);
  const savedPatternsKey = puzzle ? JSON.stringify(puzzle.row_patterns) : null;

  useEffect(() => {
    if (!puzzle) {
      setSavedValidation(null);
      return;
    }
    setSavedValidationError(null);
    apiClient
      .post<ValidationResult>(`/admin/events/${eventId}/unwordle/puzzle/validate`, {
        solutionWord: puzzle.solution_word,
        rowPatterns: puzzle.row_patterns,
      })
      .then(setSavedValidation)
      .catch((err) => setSavedValidationError(err instanceof Error ? err.message : "Could not validate"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, puzzle?.solution_word, savedPatternsKey]);

  function cycleTile(row: number, col: number) {
    setPatterns((prev) => {
      const next = prev.map((r) => [...r]);
      next[row][col] = NEXT_COLOR[next[row][col]];
      return next;
    });
    setValidation(null);
  }

  function startEditing() {
    if (puzzle) {
      setSolutionWord(puzzle.solution_word);
      setPatterns(puzzle.row_patterns.map((row) => [...row]));
    } else {
      setSolutionWord("");
      setPatterns(emptyPatterns());
    }
    setValidation(null);
    setError(null);
    setEditing(true);
  }

  async function handleValidate() {
    setError(null);
    try {
      const res = await apiClient.post<typeof validation>(`/admin/events/${eventId}/unwordle/puzzle/validate`, {
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
    try {
      await apiClient.post(`/admin/events/${eventId}/unwordle/puzzle`, { solutionWord, rowPatterns: patterns });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save puzzle");
    } finally {
      setSubmitting(false);
    }
  }

  async function togglePublish() {
    if (!puzzle) return;
    const next = puzzle.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    setSubmitting(true);
    try {
      await apiClient.post(`/admin/events/${eventId}/unwordle/puzzle/status`, { status: next });
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  if (puzzle && !editing) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Solution</p>
            <p className="font-mono text-lg font-bold">{puzzle.solution_word}</p>
          </div>
          <Badge variant={puzzle.status === "PUBLISHED" ? "success" : "secondary"}>{puzzle.status}</Badge>
          <Button size="sm" variant={puzzle.status === "PUBLISHED" ? "destructive" : "default"} onClick={togglePublish} disabled={submitting}>
            {puzzle.status === "PUBLISHED" ? "Unpublish" : "Publish"}
          </Button>
          <Button size="sm" variant="outline" onClick={startEditing} disabled={submitting}>
            Edit
          </Button>
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Player preview — the solution is always shown as a reference row below these 4
          </p>
          {savedValidationError && <p className="mb-1.5 text-xs text-destructive">{savedValidationError}</p>}
          <div className="space-y-1.5">
            {puzzle.row_patterns.map((pattern, i) => {
              const rowResult = savedValidation?.rowResults.find((r) => r.rowIndex === i);
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                  <div className="flex gap-1">
                    {pattern.map((color, j) => (
                      <WordleTile key={j} size="sm" state="pattern" patternColor={color} />
                    ))}
                  </div>
                  {!rowResult ? (
                    <span className="text-xs text-muted-foreground">Checking...</span>
                  ) : rowResult.satisfiable ? (
                    <span className="text-xs text-success">✓ e.g. {rowResult.sampleWords.join(", ")}</span>
                  ) : (
                    <span className="text-xs font-semibold text-destructive">
                      ✕ no valid dictionary word matches this pattern
                    </span>
                  )}
                </div>
              );
            })}
            <div className="flex items-center gap-2">
              <span className="w-4" />
              <div className="flex gap-1">
                {puzzle.solution_word.split("").map((letter, j) => (
                  <WordleTile key={j} size="sm" state="correct" letter={letter} />
                ))}
              </div>
              <span className="text-xs text-success">✓ reference — always shown to players</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {editing && puzzle && hasSessions && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Players already have Playoffs sessions for this puzzle — changing the solution or patterns changes what
          they're solving, including anyone already in progress or finished.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="solution">Solution</Label>
          <Input
            id="solution"
            value={solutionWord}
            onChange={(e) => setSolutionWord(e.target.value.toUpperCase())}
            maxLength={5}
            className="w-32 font-mono uppercase"
          />
        </div>
        <Button variant="outline" onClick={handleValidate} disabled={solutionWord.length !== 5}>
          Validate
        </Button>
        <Button onClick={handleSave} disabled={submitting || solutionWord.length !== 5 || !validation?.valid}>
          {editing && puzzle ? "Save changes" : "Create Puzzle"}
        </Button>
        {editing && puzzle && (
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={submitting}>
            Cancel
          </Button>
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
      <p className="text-xs text-muted-foreground">
        Click a tile to cycle gray → yellow → green. Players always see the solution word as a fixed reference row —
        these 4 rows can use any pattern, no need to set one all-green anymore.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
