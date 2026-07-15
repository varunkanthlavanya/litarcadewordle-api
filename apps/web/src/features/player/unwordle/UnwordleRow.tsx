import { Check } from "lucide-react";
import { WordleTile } from "@/components/shared/WordleTile";
import { cn } from "@/lib/utils";
import type { UnwordleRowDto } from "@litarcadewordle/shared-types";

const REVEAL_STAGGER_MS = 180;

interface UnwordleRowProps {
  row: UnwordleRowDto;
  selected: boolean;
  onSelect: () => void;
  /** The letters currently typed into this row, shown live in the tiles —
   * only passed for the selected, unsolved row. Everything else about the
   * tile (its given color) stays fixed; only the letter is user-driven. */
  currentGuess?: string;
  /** True for exactly the render where this row transitions to solved —
   * staggers the solved word's letters in rather than having them just
   * appear, and bounces the checkmark in afterward. */
  justSolved?: boolean;
  /** Briefly shakes the row — feedback for a rejected submission (invalid
   * word, or doesn't match this row's given color pattern). */
  shake?: boolean;
}

export function UnwordleRow({ row, selected, onSelect, currentGuess, justSolved, shake }: UnwordleRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={row.solved}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-2 text-left transition-colors",
        row.solved ? "border-success/40 bg-success-subtle" : "border-border",
        selected && !row.solved && "border-primary ring-1 ring-primary",
        shake && "animate-shake"
      )}
    >
      <div className="grid grid-cols-5 gap-1.5">
        {row.pattern.map((color, i) => {
          const typedLetter = currentGuess?.[i] ?? "";
          const letter = row.solved ? row.solvedWord?.[i] ?? "" : typedLetter;
          return (
            <WordleTile
              key={row.solved ? `solved-${i}` : `typing-${i}-${typedLetter}`}
              size="md"
              state="pattern"
              patternColor={color}
              letter={letter}
              revealDelayMs={justSolved ? i * REVEAL_STAGGER_MS : undefined}
              pop={!row.solved && typedLetter !== ""}
            />
          );
        })}
      </div>
      {row.solved && (
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground",
            justSolved && "animate-tile-bounce"
          )}
          style={justSolved ? { animationDelay: `${row.pattern.length * REVEAL_STAGGER_MS}ms` } : undefined}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}
