import { cn } from "@/lib/utils";
import type { TileColor } from "@litarcadewordle/shared-types";

export type WordleTileState = "correct" | "present" | "absent" | "empty" | "skipped" | "pattern";

const COLOR_STATE_CLASSES: Record<"correct" | "present" | "absent", string> = {
  correct: "bg-tile-green border-tile-green text-white",
  present: "bg-tile-yellow border-tile-yellow text-white",
  absent: "bg-tile-gray border-tile-gray text-white",
};

const TILE_COLOR_TO_STATE: Record<TileColor, "correct" | "present" | "absent"> = {
  GREEN: "correct",
  YELLOW: "present",
  GRAY: "absent",
};

interface WordleTileProps {
  state: WordleTileState;
  letter?: string;
  /** Required when state === "pattern" — the row's given (not guessed) color. */
  patternColor?: TileColor;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<WordleTileProps["size"]>, string> = {
  sm: "h-9 w-9 text-base",
  md: "h-12 w-12 text-xl sm:h-14 sm:w-14",
  lg: "h-14 w-14 text-2xl sm:h-16 sm:w-16",
};

export function WordleTile({ state, letter, patternColor, size = "md", className }: WordleTileProps) {
  if (state === "skipped") {
    return (
      <div
        className={cn(
          "tile-skipped flex items-center justify-center rounded-[8px] font-mono text-[10px] font-bold uppercase",
          SIZE_CLASSES[size],
          className
        )}
      >
        SKIP
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[8px] border-2 border-tile-empty-border text-xl font-bold uppercase",
          SIZE_CLASSES[size],
          className
        )}
      >
        {letter}
      </div>
    );
  }

  const colorState = state === "pattern" ? (patternColor ? TILE_COLOR_TO_STATE[patternColor] : "absent") : state;

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-[8px] border-2 font-bold uppercase",
        COLOR_STATE_CLASSES[colorState],
        SIZE_CLASSES[size],
        className
      )}
    >
      {letter}
    </div>
  );
}
