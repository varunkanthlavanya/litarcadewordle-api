import type { UnwordleBankPuzzleDto } from "@litarcadewordle/shared-types";
import { Badge } from "@/components/ui/badge";
import { WordleTile } from "@/components/shared/WordleTile";

/** Visual QA for the whole puzzle bank before Publish — reuses WordleTile's
 * existing "pattern" rendering (same call shape as UwPuzzleSetup's
 * saved-view). Dictionary satisfiability is already checked server-side at
 * upload time; this is purely for the class of mistake that check *can't*
 * catch, like two puzzles accidentally being identical (PRD §3.4/§10
 * scenario 3) — only a human eyeballing tiles catches that. */
export function UnwordleTilePreviewGrid({ puzzles }: { puzzles: UnwordleBankPuzzleDto[] }) {
  if (puzzles.length === 0) {
    return <p className="text-sm text-muted-foreground">No puzzles banked yet.</p>;
  }

  return (
    <div className="max-h-[32rem] space-y-3 overflow-auto rounded-lg border p-3">
      {puzzles.map((puzzle) => (
        <div key={puzzle.id} className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3">
          <div className="w-14 shrink-0 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Puzzle</p>
            <p className="font-mono text-lg font-bold">{puzzle.puzzleNumber}</p>
          </div>
          <div className="shrink-0">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Solution</p>
            <p className="font-mono text-sm font-bold">{puzzle.solutionWord}</p>
          </div>
          <div className="flex flex-1 flex-wrap gap-2">
            {puzzle.rowPatterns.map((pattern, rowIndex) => (
              <div key={rowIndex} className="flex gap-1">
                {pattern.map((color, tileIndex) => (
                  <WordleTile key={tileIndex} size="sm" state="pattern" patternColor={color} />
                ))}
              </div>
            ))}
          </div>
          <Badge variant={puzzle.status === "PUBLISHED" ? "success" : "secondary"}>{puzzle.status}</Badge>
        </div>
      ))}
    </div>
  );
}
