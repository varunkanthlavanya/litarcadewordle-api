import { VALID_GUESS_WORDS } from "../../data/validGuesses.js";
import { SOLUTION_WORDS } from "../../data/solutionWords.js";

const validGuessSet = new Set(VALID_GUESS_WORDS);
const solutionSet = new Set(SOLUTION_WORDS);

/** Every word in the bundled corpus is a valid guess (UNWORDLE §3.1 strict validation). */
export function isValidGuessWord(word: string): boolean {
  return validGuessSet.has(word.toUpperCase());
}

/** Solution words are a curated, more-common subset — used for picking secret words
 * and Timed Wordle puzzle answers, not for guess validation. */
export function isSolutionCandidate(word: string): boolean {
  return solutionSet.has(word.toUpperCase());
}

export function randomSolutionWord(): string {
  return SOLUTION_WORDS[Math.floor(Math.random() * SOLUTION_WORDS.length)];
}

export function allValidGuessWords(): readonly string[] {
  return VALID_GUESS_WORDS;
}

export function wordCorpusSize(): { validGuesses: number; solutions: number } {
  return { validGuesses: VALID_GUESS_WORDS.length, solutions: SOLUTION_WORDS.length };
}
