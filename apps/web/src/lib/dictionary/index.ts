import { VALID_GUESS_WORDS } from "./validGuesses";

const validGuessSet = new Set(VALID_GUESS_WORDS);

export function isValidGuessWord(word: string): boolean {
  return validGuessSet.has(word.toUpperCase());
}
