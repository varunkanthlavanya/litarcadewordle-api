import type { TileColor } from "@litarcadewordle/shared-types";
import { WORD_LENGTH } from "./constants.js";

export type { TileColor };

const COLOR_RANK: Record<TileColor, number> = { GRAY: 0, YELLOW: 1, GREEN: 2 };

/** Standard Wordle duplicate-letter feedback: exact matches resolved first (green),
 * remaining letter counts determine yellow allocation, excess duplicates are gray. */
export function computeFeedback(guess: string, secret: string): TileColor[] {
  const g = guess.toUpperCase().split("");
  const s = secret.toUpperCase().split("");
  const feedback: TileColor[] = new Array(WORD_LENGTH).fill("GRAY");
  const remaining: Record<string, number> = {};

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === s[i]) {
      feedback[i] = "GREEN";
    } else {
      remaining[s[i]] = (remaining[s[i]] ?? 0) + 1;
    }
  }

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (feedback[i] === "GREEN") continue;
    const letter = g[i];
    if ((remaining[letter] ?? 0) > 0) {
      feedback[i] = "YELLOW";
      remaining[letter] -= 1;
    }
  }

  return feedback;
}

export interface TileScoreResult {
  slotScores: number[];
  total: number;
}

/**
 * Per-slot best-ever-color scoring (PRD §4.2). Slots are secret-word positions, not
 * guess positions — a slot's score is fixed by the best color it has ever reached
 * across every try. Duplicate letters (appearing >1x in the secret) score Yellow as 0;
 * Green always scores independently per slot regardless of the sibling duplicate slot.
 */
export function computeTileScore(secret: string, allFeedbacks: Array<TileColor[] | null>): TileScoreResult {
  const secretLetters = secret.toUpperCase().split("");
  const letterCounts: Record<string, number> = {};
  for (const letter of secretLetters) {
    letterCounts[letter] = (letterCounts[letter] ?? 0) + 1;
  }

  const bestColor: TileColor[] = new Array(WORD_LENGTH).fill("GRAY");
  for (const feedback of allFeedbacks) {
    if (!feedback) continue;
    for (let i = 0; i < WORD_LENGTH; i++) {
      if (COLOR_RANK[feedback[i]] > COLOR_RANK[bestColor[i]]) {
        bestColor[i] = feedback[i];
      }
    }
  }

  const slotScores: number[] = bestColor.map((color, i) => {
    if (color === "GREEN") return 2;
    if (color === "YELLOW") {
      const isDuplicateLetter = letterCounts[secretLetters[i]] > 1;
      return isDuplicateLetter ? 0 : 1;
    }
    return 0;
  });

  return { slotScores, total: slotScores.reduce((a, b) => a + b, 0) };
}

export interface RankableTimedWordleSession {
  id: number;
  found: boolean;
  cumulativeTimeMs: number;
  triesUsed: number;
  tileScore: number;
}

/** Sequential priority waterfall (PRD §4.1): found > time > tries > tiles > id. */
export function compareTimedWordleSessions(
  a: RankableTimedWordleSession,
  b: RankableTimedWordleSession
): number {
  if (a.found !== b.found) return a.found ? -1 : 1;
  if (a.cumulativeTimeMs !== b.cumulativeTimeMs) return a.cumulativeTimeMs - b.cumulativeTimeMs;
  if (a.triesUsed !== b.triesUsed) return a.triesUsed - b.triesUsed;
  if (a.tileScore !== b.tileScore) return b.tileScore - a.tileScore;
  return a.id - b.id;
}
