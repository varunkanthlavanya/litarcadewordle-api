// Verbatim port of apps/api/src/modules/dictionary/dictionary.service.ts
import { VALID_GUESS_WORDS } from "./validGuesses.ts";
import { SOLUTION_WORDS } from "./solutionWords.ts";

const validGuessSet = new Set(VALID_GUESS_WORDS);
const solutionSet = new Set(SOLUTION_WORDS);

export function isValidGuessWord(word: string): boolean {
  return validGuessSet.has(word.toUpperCase());
}

export function isSolutionCandidate(word: string): boolean {
  return solutionSet.has(word.toUpperCase());
}

export function randomSolutionWord(): string {
  return SOLUTION_WORDS[Math.floor(Math.random() * SOLUTION_WORDS.length)];
}
