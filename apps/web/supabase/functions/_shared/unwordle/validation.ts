// Verbatim port of apps/api/src/modules/unwordle/engine/validation.ts
// (TileColor inlined; see timedWordle/scoring.ts for the same note.)
export type TileColor = "GREEN" | "YELLOW" | "GRAY";

export const ROW_LENGTH = 5;
export const ROWS_PER_PUZZLE = 4;

export type TileFailureReason =
  | "WRONG_LETTER_AT_GREEN_SLOT"
  | "YELLOW_LETTER_NOT_IN_SOLUTION"
  | "YELLOW_LETTER_IN_SAME_POSITION"
  | "GRAY_LETTER_IS_IN_SOLUTION";

export interface FailedTile {
  position: number;
  reason: TileFailureReason;
}

export interface GuessValidationResult {
  lengthValid: boolean;
  isDictionaryWord: boolean;
  satisfiesAllTiles: boolean;
  failedTiles: FailedTile[];
}

/**
 * Validates a submitted word against a row's pre-colored pattern relative to the
 * solution word (PRD §3, §6.2.2). Duplicate-letter presence checks use a simple
 * "does this letter appear anywhere in the solution" test — UNWORDLE rows are
 * statically pre-colored, so (unlike live Wordle feedback) there's no sequential
 * remaining-count resolution to do here.
 */
export function validateGuess(
  guess: string,
  solution: string,
  rowPattern: TileColor[],
  isDictionaryWord: (word: string) => boolean
): GuessValidationResult {
  const g = guess.toUpperCase();
  if (g.length !== ROW_LENGTH) {
    return { lengthValid: false, isDictionaryWord: false, satisfiesAllTiles: false, failedTiles: [] };
  }

  if (!isDictionaryWord(g)) {
    return { lengthValid: true, isDictionaryWord: false, satisfiesAllTiles: false, failedTiles: [] };
  }

  const s = solution.toUpperCase();
  const solutionLetters = new Set(s.split(""));
  const failedTiles: FailedTile[] = [];

  for (let i = 0; i < ROW_LENGTH; i++) {
    const tile = rowPattern[i];
    const letter = g[i];

    if (tile === "GREEN") {
      if (letter !== s[i]) {
        failedTiles.push({ position: i, reason: "WRONG_LETTER_AT_GREEN_SLOT" });
      }
    } else if (tile === "YELLOW") {
      if (letter === s[i]) {
        failedTiles.push({ position: i, reason: "YELLOW_LETTER_IN_SAME_POSITION" });
      } else if (!solutionLetters.has(letter)) {
        failedTiles.push({ position: i, reason: "YELLOW_LETTER_NOT_IN_SOLUTION" });
      }
    } else {
      if (solutionLetters.has(letter)) {
        failedTiles.push({ position: i, reason: "GRAY_LETTER_IS_IN_SOLUTION" });
      }
    }
  }

  return {
    lengthValid: true,
    isDictionaryWord: true,
    satisfiesAllTiles: failedTiles.length === 0,
    failedTiles,
  };
}
