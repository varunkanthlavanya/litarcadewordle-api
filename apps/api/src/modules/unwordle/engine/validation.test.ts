import { describe, expect, it } from "vitest";
import { validateGuess } from "./validation.js";
import type { TileColor } from "@litarcadewordle/shared-types";

const DICTIONARY = new Set(["APPLE", "PLATE", "PAPER", "ALLOW", "ROBOT", "BRAVE", "CRANE", "XZQVJ"]);
const isDictionaryWord = (w: string) => DICTIONARY.has(w.toUpperCase());

describe("validateGuess — PRD §7 acceptance criteria", () => {
  it("#1 rejects a non-dictionary word regardless of tile pattern", () => {
    const pattern: TileColor[] = ["GREEN", "GREEN", "GREEN", "GREEN", "GREEN"];
    const result = validateGuess("ZZZZZ", "APPLE", pattern, isDictionaryWord);
    expect(result.isDictionaryWord).toBe(false);
    expect(result.satisfiesAllTiles).toBe(false);
  });

  it("#2 rejects a real word that violates a Green tile, with a reason for that tile", () => {
    // solution APPLE, row pattern all green (row demands the word itself)
    const pattern: TileColor[] = ["GREEN", "GREEN", "GREEN", "GREEN", "GREEN"];
    const result = validateGuess("PLATE", "APPLE", pattern, isDictionaryWord);
    expect(result.isDictionaryWord).toBe(true);
    expect(result.satisfiesAllTiles).toBe(false);
    expect(result.failedTiles.length).toBeGreaterThan(0);
    expect(result.failedTiles.every((f) => f.reason === "WRONG_LETTER_AT_GREEN_SLOT")).toBe(true);
  });

  it("#3 accepts a word satisfying every tile constraint", () => {
    const pattern: TileColor[] = ["GREEN", "GREEN", "GREEN", "GREEN", "GREEN"];
    const result = validateGuess("APPLE", "APPLE", pattern, isDictionaryWord);
    expect(result.satisfiesAllTiles).toBe(true);
    expect(result.failedTiles).toHaveLength(0);
  });

  it("#4 allows reusing a duplicate secret letter elsewhere when one duplicate slot is Yellow", () => {
    // solution APPLE (P at index1,2). Row pattern: index1=GREEN (must be P),
    // index2=YELLOW (must be a solution letter, not P at that exact slot, and not
    // necessarily forbidding P appearing at a different index in the guess).
    const pattern: TileColor[] = ["GRAY", "GREEN", "YELLOW", "GRAY", "GRAY"];
    // Guess: index0=X(gray,not in APPLE), index1=P(green), index2=some letter that is
    // in APPLE but not P at that slot and not equal to secret[2]='P' -> use 'L'.
    // Build a guess "XPLXX" is not a real word; use dictionary-word-agnostic check via
    // custom predicate for this isolated tile-constraint test.
    const alwaysWord = () => true;
    const result = validateGuess("XPLXX", "APPLE", pattern, alwaysWord);
    expect(result.satisfiesAllTiles).toBe(true);
  });

  it("flags a Yellow tile letter that is not present anywhere in the solution", () => {
    const pattern: TileColor[] = ["YELLOW", "GRAY", "GRAY", "GRAY", "GRAY"];
    const alwaysWord = () => true;
    const result = validateGuess("ZZZZZ", "APPLE", pattern, alwaysWord);
    expect(result.satisfiesAllTiles).toBe(false);
    expect(result.failedTiles[0].reason).toBe("YELLOW_LETTER_NOT_IN_SOLUTION");
  });

  it("flags a Yellow tile letter placed in the exact same position as the solution (should be Green)", () => {
    const pattern: TileColor[] = ["YELLOW", "GRAY", "GRAY", "GRAY", "GRAY"];
    const alwaysWord = () => true;
    const result = validateGuess("AZZZZ", "APPLE", pattern, alwaysWord); // A at idx0 matches secret's A at idx0
    expect(result.satisfiesAllTiles).toBe(false);
    expect(result.failedTiles[0].reason).toBe("YELLOW_LETTER_IN_SAME_POSITION");
  });

  it("flags a Gray tile letter that actually appears in the solution", () => {
    const pattern: TileColor[] = ["GRAY", "GRAY", "GRAY", "GRAY", "GRAY"];
    const alwaysWord = () => true;
    const result = validateGuess("PZZZZ", "APPLE", pattern, alwaysWord); // P appears in APPLE
    expect(result.satisfiesAllTiles).toBe(false);
    expect(result.failedTiles[0].reason).toBe("GRAY_LETTER_IS_IN_SOLUTION");
  });

  it("rejects a guess that is not exactly 5 letters", () => {
    const pattern: TileColor[] = ["GREEN", "GREEN", "GREEN", "GREEN", "GREEN"];
    const result = validateGuess("AP", "APPLE", pattern, isDictionaryWord);
    expect(result.lengthValid).toBe(false);
  });
});
