// Verbatim port of apps/api/src/modules/unwordle/engine/puzzleValidator.ts
import { validateGuess, type TileColor } from "./validation.ts";

export interface RowSatisfiabilityResult {
  rowIndex: number;
  satisfiable: boolean;
  sampleWords: string[];
}

/** Checks whether at least one word in `candidateWords` satisfies a row's pattern
 * relative to the solution — the PRD's pre-publish "must be satisfiable by a real
 * dictionary word" requirement (§5). `candidateWords` is injected so this stays a
 * pure function independent of the dictionary module. */
export function checkRowSatisfiability(
  solution: string,
  pattern: TileColor[],
  candidateWords: readonly string[],
  sampleLimit = 3
): { satisfiable: boolean; sampleWords: string[] } {
  const samples: string[] = [];
  for (const word of candidateWords) {
    if (word === solution.toUpperCase() && pattern.every((c) => c === "GREEN")) {
      samples.push(word);
      if (samples.length >= sampleLimit) break;
      continue;
    }
    const result = validateGuess(word, solution, pattern, () => true);
    if (result.satisfiesAllTiles) {
      samples.push(word);
      if (samples.length >= sampleLimit) break;
    }
  }
  return { satisfiable: samples.length > 0, sampleWords: samples };
}

export function validatePuzzlePatterns(
  solution: string,
  rowPatterns: TileColor[][],
  candidateWords: readonly string[]
): { valid: boolean; rowResults: RowSatisfiabilityResult[] } {
  const rowResults = rowPatterns.map((pattern, rowIndex) => ({
    rowIndex,
    ...checkRowSatisfiability(solution, pattern, candidateWords),
  }));
  return { valid: rowResults.every((r) => r.satisfiable), rowResults };
}
