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

interface WordGridProps {
  tries: TimedWordleTryDto[];
  currentGuess: string;
  /** Briefly shakes the in-progress row — mirrors real Wordle's feedback for
   * submitting too few letters. */
  shakeCurrentRow?: boolean;
}

export function WordGrid({ tries, currentGuess, shakeCurrentRow }: WordGridProps) {
  const rows = Array.from({ length: MAX_TRIES }, (_, rowIndex) => {
    const resolvedTry = tries[rowIndex];
    const isCurrentRow = rowIndex === tries.length;

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
            return <WordleTile key={colIndex} state={COLOR_TO_STATE[color]} letter={letter} />;
          }

          if (isCurrentRow) {
            return <WordleTile key={colIndex} state="empty" letter={currentGuess[colIndex] ?? ""} />;
          }

          return <WordleTile key={colIndex} state="empty" />;
        })}
      </div>
    );
  });

  return <div className="flex flex-col gap-1.5">{rows}</div>;
}
