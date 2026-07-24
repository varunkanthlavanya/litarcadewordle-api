import { useRef } from "react";
import { cn } from "@/lib/utils";
import { WordleTile } from "@/components/shared/WordleTile";
import type { TileColor, TimedWordleTryDto } from "@litarcadewordle/shared-types";

const WORD_LENGTH = 5;
const MAX_TRIES = 6;

const COLOR_TO_STATE: Record<TileColor, "correct" | "present" | "absent"> = {
  GREEN: "correct",
  YELLOW: "present",
  GRAY: "absent",
};

// Deliberately much slower/more visible than the shared WordleTile default
// (650ms, still used by UNWORDLE) — FLIP_DURATION_MS is passed to WordleTile
// explicitly per-tile (see flipDurationMs below) so this only affects Timed
// Wordle. WordleTile swaps in the true color/letter and drops the flip
// class at exactly the animation's HALFWAY point (rotateX 90deg, edge-on —
// see WordleTile.tsx), not at the end, so the total wall-clock time until
// the last tile visibly settles is (WORD_LENGTH-1)*STAGGER + DURATION/2, not
// +DURATION: (5-1)*500 + 1100/2 = 2000 + 550 = 2550ms, comfortably over the
// 2.5s floor asked for.
const FLIP_STAGGER_MS = 500;
const FLIP_DURATION_MS = 1100;
const BOUNCE_STAGGER_MS = 80;

interface WordGridProps {
  tries: TimedWordleTryDto[];
  currentGuess: string;
  /** Briefly shakes the in-progress row — mirrors real Wordle's feedback for
   * submitting too few letters. */
  shakeCurrentRow?: boolean;
  /** True once the game ended with the word found — triggers the winning
   * row's bounce celebration once its flip-reveal finishes. */
  found?: boolean;
}

export function WordGrid({ tries, currentGuess, shakeCurrentRow, found }: WordGridProps) {
  // Tries already present the first time this mounts (a page reload mid-game,
  // or revisiting a finished game) shouldn't replay the reveal animation —
  // only tries appended *during this session* should flip in. Captured once
  // on mount and never updated.
  const animateFromIndexRef = useRef<number | null>(null);
  if (animateFromIndexRef.current === null) animateFromIndexRef.current = tries.length;
  const animateFromIndex = animateFromIndexRef.current;

  const rows = Array.from({ length: MAX_TRIES }, (_, rowIndex) => {
    const resolvedTry = tries[rowIndex];
    const isCurrentRow = rowIndex === tries.length;
    const isNewlyResolved = !!resolvedTry && rowIndex >= animateFromIndex;
    const isWinningRow =
      !!found && rowIndex === tries.length - 1 && !!resolvedTry?.feedback?.every((c) => c === "GREEN");

    return (
      <div
        key={rowIndex}
        className={cn("grid grid-cols-5 gap-1.5", isCurrentRow && shakeCurrentRow && "animate-shake")}
      >
        {Array.from({ length: WORD_LENGTH }, (_, colIndex) => {
          if (resolvedTry) {
            if (resolvedTry.status === "SKIPPED") {
              return <WordleTile key={colIndex} state="skipped" />;
            }
            const letter = resolvedTry.guess?.[colIndex] ?? "";
            const color = resolvedTry.feedback?.[colIndex] ?? "GRAY";
            const revealDelayMs = isNewlyResolved ? colIndex * FLIP_STAGGER_MS : undefined;
            const bounceDelayMs =
              isWinningRow && isNewlyResolved
                ? WORD_LENGTH * FLIP_STAGGER_MS + FLIP_DURATION_MS + colIndex * BOUNCE_STAGGER_MS
                : undefined;
            return (
              <WordleTile
                key={colIndex}
                state={COLOR_TO_STATE[color]}
                letter={letter}
                revealDelayMs={revealDelayMs}
                flipDurationMs={FLIP_DURATION_MS}
                bounceDelayMs={bounceDelayMs}
              />
            );
          }

          if (isCurrentRow) {
            const typedLetter = currentGuess[colIndex] ?? "";
            return (
              <WordleTile
                key={`${colIndex}-${typedLetter}`}
                state="empty"
                letter={typedLetter}
                pop={typedLetter !== ""}
              />
            );
          }

          return <WordleTile key={colIndex} state="empty" />;
        })}
      </div>
    );
  });

  return <div className="flex flex-col gap-1.5">{rows}</div>;
}
