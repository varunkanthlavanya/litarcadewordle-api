// The word corpus is bundled directly as generated TS modules under src/data/
// (validGuesses.ts, solutionWords.ts) — no DB seeding step needed. This script is a
// smoke-test confirming the dictionary service loads the bundled corpus correctly.
import { wordCorpusSize, isValidGuessWord, isSolutionCandidate } from "../src/modules/dictionary/dictionary.service.js";

const { validGuesses, solutions } = wordCorpusSize();
console.log(`Loaded ${validGuesses} valid-guess words and ${solutions} solution-candidate words.`);
console.log(`Sanity check — "CRANE" is a valid guess: ${isValidGuessWord("CRANE")}, a solution candidate: ${isSolutionCandidate("CRANE")}`);
