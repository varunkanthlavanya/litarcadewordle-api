import type { TileColor } from "@litarcadewordle/shared-types";

/** A row whose given pattern is entirely GREEN has no ambiguity — Green
 * always means "this exact letter, this exact position", so an all-green
 * pattern already fully specifies the solution word. Matches the backend's
 * freebie/auto-solve check in `_shared/unwordle/stateMachine.ts` exactly. */
export function isTargetPattern(pattern: TileColor[]): boolean {
  return pattern.every((c) => c === "GREEN");
}

/** Orders rows the way players should see them: the target/reference row(s)
 * always last (bottom), everything else in its original order above — so
 * the answer players are working from reads as a fixed anchor at the bottom
 * of the board, not wherever it happened to land in puzzle setup. */
export function orderRowsForDisplay<T>(rows: T[], getPattern: (row: T) => TileColor[]): T[] {
  const rest: T[] = [];
  const target: T[] = [];
  for (const row of rows) {
    (isTargetPattern(getPattern(row)) ? target : rest).push(row);
  }
  return [...rest, ...target];
}
