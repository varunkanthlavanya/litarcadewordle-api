import { useEffect, useState } from "react";
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

// Default matches tailwind.config.ts's "tile-flip" animation duration — half
// of it is the moment the tile is edge-on (rotateX 90deg) and invisible,
// which is when a real Wordle-style reveal swaps the hidden face for the
// true one. Callers that want a slower/faster reveal (see WordGrid.tsx)
// override it per-instance via `flipDurationMs`, applied as an inline
// `animation-duration` — CSS lets a longhand property set inline win over
// the shorthand `animation` the "tile-flip" utility class sets, so this
// doesn't require touching the shared Tailwind keyframe or affecting any
// other caller (e.g. UNWORDLE's UnwordleRow, which never passes this prop).
const DEFAULT_FLIP_DURATION_MS = 650;

interface WordleTileProps {
  state: WordleTileState;
  letter?: string;
  /** Required when state === "pattern" — the row's given (not guessed) color. */
  patternColor?: TileColor;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Set to stagger a real-Wordle-style flip reveal: the tile stays face-down
   * (bordered, no color) until this delay elapses, then flips and shows its
   * true face at the animation's midpoint. Omit for tiles that should just
   * show their final state instantly — already-resolved tries on mount,
   * static pattern-clue tiles, the in-progress row, etc. For "pattern" tiles
   * (UNWORDLE, where the color is a given clue rather than a guess result)
   * this instead reveals the solved LETTER at the midpoint, since the color
   * was never hidden. */
  revealDelayMs?: number;
  /** Overrides how long the flip itself takes (default 650ms) — see the
   * constant above for why this is a prop and not a shared constant. */
  flipDurationMs?: number;
  /** Plays the win-celebration bounce, delayed by this many ms (queued to
   * start after this tile's own reveal flip has finished). */
  bounceDelayMs?: number;
  /** Quick scale-up pop, for a letter that was just typed into an empty tile
   * — pair with a `key` that changes per keystroke so the animation restarts. */
  pop?: boolean;
  /** Marks this as the next empty slot the player will type into — shown as
   * a dashed border cursor, on top of whatever color the tile already has. */
  active?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<WordleTileProps["size"]>, string> = {
  sm: "h-9 w-9 text-base",
  md: "h-12 w-12 text-xl sm:h-14 sm:w-14",
  lg: "h-14 w-14 text-2xl sm:h-16 sm:w-16",
};

export function WordleTile({
  state,
  letter,
  patternColor,
  size = "md",
  className,
  revealDelayMs,
  flipDurationMs = DEFAULT_FLIP_DURATION_MS,
  bounceDelayMs,
  pop,
  active,
}: WordleTileProps) {
  const [revealed, setRevealed] = useState(revealDelayMs === undefined);
  const [flipping, setFlipping] = useState(false);
  const [bouncing, setBouncing] = useState(false);

  useEffect(() => {
    if (revealDelayMs === undefined) {
      setRevealed(true);
      setFlipping(false);
      return;
    }
    setRevealed(false);
    setFlipping(false);
    const flipHalfMs = flipDurationMs / 2;
    const startTimer = setTimeout(() => setFlipping(true), revealDelayMs);
    // Swap the face at the animation's midpoint (rotateX 90deg — edge-on and
    // invisible) but leave `flipping` (and its CSS animation) running. An
    // earlier version cleared `flipping` here too, which killed the "tile-flip"
    // keyframe mid-flight and snapped the transform straight from rotateX(90)
    // to identity with no motion at all — the tile looked like it rotated
    // halfway down then instantly popped to its revealed face, rather than
    // completing a smooth flip. The class now only comes off via
    // onAnimationEnd below, once the animation has actually played all the
    // way back to rotateX(0deg).
    const revealTimer = setTimeout(() => setRevealed(true), revealDelayMs + flipHalfMs);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(revealTimer);
    };
  }, [revealDelayMs, flipDurationMs]);

  useEffect(() => {
    if (bounceDelayMs === undefined) {
      setBouncing(false);
      return;
    }
    setBouncing(false);
    const timer = setTimeout(() => setBouncing(true), bounceDelayMs);
    return () => clearTimeout(timer);
  }, [bounceDelayMs]);

  if (state === "skipped") {
    return (
      <div
        className={cn(
          "tile-skipped flex items-center justify-center rounded-none font-mono text-[10px] font-bold uppercase",
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
          "flex items-center justify-center rounded-none border-2 border-tile-empty-border text-xl font-bold uppercase",
          SIZE_CLASSES[size],
          pop && "animate-tile-pop",
          className
        )}
      >
        {letter}
      </div>
    );
  }

  const isPattern = state === "pattern";
  const colorState = isPattern ? (patternColor ? TILE_COLOR_TO_STATE[patternColor] : "absent") : state;
  const beforeReveal = revealDelayMs !== undefined && !revealed;

  // Non-pattern tiles (a guessed row): the color IS the thing being revealed,
  // so hide it (render as an empty-style box) until the flip's midpoint.
  // Pattern tiles (UNWORDLE's given clue): the color is always known upfront
  // — only the solved word's LETTER is new information, so that's what's
  // hidden until the reveal instead.
  const showColor = isPattern || !beforeReveal;
  const showLetter = !isPattern || !beforeReveal;

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-none border-2 font-bold uppercase",
        showColor ? COLOR_STATE_CLASSES[colorState] : "border-tile-empty-border",
        SIZE_CLASSES[size],
        flipping && "animate-tile-flip",
        bouncing && "animate-tile-bounce",
        // !important since the tile's own color classes already set a
        // same-color border (e.g. bg-tile-gray border-tile-gray) — without
        // it, a dashed border in that same color is nearly invisible.
        active && "!border-dashed !border-foreground",
        className
      )}
      style={flipping && flipDurationMs !== DEFAULT_FLIP_DURATION_MS ? { animationDuration: `${flipDurationMs}ms` } : undefined}
      onAnimationEnd={(e) => {
        // Only react to the flip animation ending, not "tile-bounce" or
        // "tile-pop" — all three can fire this event on the same element.
        if (e.animationName === "tile-flip") setFlipping(false);
      }}
    >
      {showLetter ? letter : ""}
    </div>
  );
}
