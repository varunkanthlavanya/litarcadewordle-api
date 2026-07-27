import { Check } from "lucide-react";
import { WordleTile } from "@/components/shared/WordleTile";
import { cn } from "@/lib/utils";
import type { UnwordleRowDto } from "@litarcadewordle/shared-types";

// Matches Timed Wordle's WordGrid.tsx exactly (FLIP_STAGGER_MS/FLIP_DURATION_MS)
// so both games' tile-flip reveals feel identical: total visible reveal time
// for a 5-tile row is (5-1)*STAGGER + DURATION = 4*250 + 500 = 1500ms.
const REVEAL_STAGGER_MS = 250;
const FLIP_DURATION_MS = 500;

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
  // The first empty slot in the row currently being typed into — shown with
  // a dashed cursor so it's clear exactly where the next keystroke lands.
  const activeIndex =
    selected && !row.solved ? row.pattern.findIndex((_, i) => (currentGuess?.[i] ?? "") === "") : -1;

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
              flipDurationMs={FLIP_DURATION_MS}
              pop={!row.solved && typedLetter !== ""}
              active={i === activeIndex}
            />
          );
        })}
      </div>
      {row.solved && (
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-none bg-success text-success-foreground",
            justSolved && "animate-tile-bounce"
          )}
          // Matches WordGrid.tsx's own bounce-delay formula (WORD_LENGTH *
          // FLIP_STAGGER_MS + FLIP_DURATION_MS) — a beat after the last
          // tile's flip actually settles, not mid-flight.
          style={
            justSolved ? { animationDelay: `${row.pattern.length * REVEAL_STAGGER_MS + FLIP_DURATION_MS}ms` } : undefined
          }
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}
