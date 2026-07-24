import { Check } from "lucide-react";
import { WordleTile } from "@/components/shared/WordleTile";

/** The permanent, non-interactive answer key — always visible from the
 * moment the game loads, independent of how any of the 4 guessable rows
 * are patterned. This is the fixed reference the player works backward
 * from, always anchored at the bottom of the board. */
export function UnwordleTargetRow({ solutionWord }: { solutionWord: string | null | undefined }) {
  // A stale-deployed backend (or any response missing this field) must not
  // blank the whole page — this row just doesn't render until it's there,
  // same as any other still-loading piece of state.
  if (!solutionWord) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-success/40 bg-success-subtle p-2">
      <div className="grid grid-cols-5 gap-1.5">
        {solutionWord.split("").map((letter, i) => (
          <WordleTile key={i} size="md" state="correct" letter={letter} />
        ))}
      </div>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none bg-success text-success-foreground">
        <Check className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}
