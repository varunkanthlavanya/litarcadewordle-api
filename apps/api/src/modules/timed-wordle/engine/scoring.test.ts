import { describe, expect, it } from "vitest";
import { computeFeedback, computeTileScore, compareTimedWordleSessions } from "./scoring.js";

describe("computeFeedback", () => {
  it("marks exact matches green", () => {
    expect(computeFeedback("APPLE", "APPLE")).toEqual(["GREEN", "GREEN", "GREEN", "GREEN", "GREEN"]);
  });

  it("marks absent letters gray", () => {
    expect(computeFeedback("BRICK", "APPLE")).toEqual(["GRAY", "GRAY", "GRAY", "GRAY", "GRAY"]);
  });

  it("resolves duplicate letters using standard remaining-count logic", () => {
    // secret PAPER, guess ALARM -> A is present once in secret at index 1 (guess index 0
    // is wrong position), guess has two A's (index 0, 2); only one should be yellow.
    const feedback = computeFeedback("ALARM", "PAPER");
    expect(feedback[0]).toBe("YELLOW"); // A present in secret, wrong slot
    expect(feedback[2]).toBe("GRAY"); // second A already consumed by remaining-count
  });

  it("does not mark more occurrences of a letter than the secret actually contains", () => {
    // secret ROBOT has exactly two O's; guess OXOXO has three O's — only two may be
    // marked yellow/green, the excess third occurrence must be gray.
    const feedback = computeFeedback("OXOXO", "ROBOT");
    const oCount = feedback.filter((c, i) => "OXOXO"[i] === "O" && c !== "GRAY").length;
    expect(oCount).toBe(2);
    expect(feedback[4]).toBe("GRAY"); // the excess third O
  });
});

describe("computeTileScore — APPLE duplicate-letter worked examples (PRD §4.2)", () => {
  const secret = "APPLE";

  it("both P's found Green -> 4", () => {
    const feedback = computeFeedback("APPLE", secret); // all green
    const { total } = computeTileScore(secret, [feedback]);
    expect(total).toBe(10); // all 5 slots green = 5*2
    // isolate just the P slots (indices 1 and 2)
    const { slotScores } = computeTileScore(secret, [feedback]);
    expect(slotScores[1] + slotScores[2]).toBe(4);
  });

  it("one P Green, one P Yellow -> 2", () => {
    // guess with P correct at index 1 (green), and a P at index 2 that's wrong-position
    // relative to secret's second P (secret PAPPLE has P at 1 and 2 both) -> construct
    // a guess where slot1=P (green) and slot2 has some other letter causing the *other*
    // occurrence to only ever be yellow across tries. We simulate directly via two
    // feedback arrays representing best-ever colors per slot.
    const feedbackTry1: ("GREEN" | "YELLOW" | "GRAY")[] = ["GRAY", "GREEN", "YELLOW", "GRAY", "GRAY"];
    const { slotScores } = computeTileScore(secret, [feedbackTry1]);
    expect(slotScores[1]).toBe(2);
    expect(slotScores[2]).toBe(0); // duplicate letter, yellow scores 0
    expect(slotScores[1] + slotScores[2]).toBe(2);
  });

  it("both P's only ever Yellow -> 0", () => {
    const feedbackTry1: ("GREEN" | "YELLOW" | "GRAY")[] = ["GRAY", "YELLOW", "YELLOW", "GRAY", "GRAY"];
    const { slotScores } = computeTileScore(secret, [feedbackTry1]);
    expect(slotScores[1]).toBe(0);
    expect(slotScores[2]).toBe(0);
  });

  it("one P Green, one P never found (Gray) -> 2", () => {
    const feedbackTry1: ("GREEN" | "YELLOW" | "GRAY")[] = ["GRAY", "GREEN", "GRAY", "GRAY", "GRAY"];
    const { slotScores } = computeTileScore(secret, [feedbackTry1]);
    expect(slotScores[1]).toBe(2);
    expect(slotScores[2]).toBe(0);
    expect(slotScores[1] + slotScores[2]).toBe(2);
  });

  it("non-duplicate letters score standard green=2/yellow=1/gray=0", () => {
    // A (idx0), L (idx3), E (idx4) each appear once in APPLE
    const feedbackTry1: ("GREEN" | "YELLOW" | "GRAY")[] = ["YELLOW", "GRAY", "GRAY", "GREEN", "GRAY"];
    const { slotScores } = computeTileScore(secret, [feedbackTry1]);
    expect(slotScores[0]).toBe(1); // A yellow, non-duplicate -> 1 point
    expect(slotScores[3]).toBe(2); // L green -> 2 points
    expect(slotScores[4]).toBe(0); // E gray -> 0
  });

  it("keeps the best-ever color per slot across tries, no double counting", () => {
    const tryA: ("GREEN" | "YELLOW" | "GRAY")[] = ["GRAY", "YELLOW", "GRAY", "GRAY", "GRAY"];
    const tryB: ("GREEN" | "YELLOW" | "GRAY")[] = ["GRAY", "GREEN", "GRAY", "GRAY", "GRAY"];
    const { slotScores } = computeTileScore(secret, [tryA, tryB]);
    expect(slotScores[1]).toBe(2); // green in try B wins, not yellow+green summed
  });

  it("ignores skipped tries (null feedback) when computing best-ever color", () => {
    const tryA: ("GREEN" | "YELLOW" | "GRAY")[] = ["GRAY", "GREEN", "GRAY", "GRAY", "GRAY"];
    const { slotScores } = computeTileScore(secret, [tryA, null]);
    expect(slotScores[1]).toBe(2);
  });
});

describe("compareTimedWordleSessions — leaderboard waterfall (PRD §4.1)", () => {
  it("ranks found above not-found regardless of other tiers", () => {
    const found = { id: 2, found: true, cumulativeTimeMs: 359_000, triesUsed: 6, tileScore: 0 };
    const notFound = { id: 1, found: false, cumulativeTimeMs: 100, triesUsed: 1, tileScore: 10 };
    expect(compareTimedWordleSessions(found, notFound)).toBeLessThan(0);
  });

  it("breaks ties by lower cumulative time", () => {
    const a = { id: 1, found: true, cumulativeTimeMs: 100_000, triesUsed: 3, tileScore: 5 };
    const b = { id: 2, found: true, cumulativeTimeMs: 90_000, triesUsed: 3, tileScore: 5 };
    expect(compareTimedWordleSessions(a, b)).toBeGreaterThan(0);
  });

  it("falls to tries used when time is tied", () => {
    const a = { id: 1, found: true, cumulativeTimeMs: 100_000, triesUsed: 4, tileScore: 5 };
    const b = { id: 2, found: true, cumulativeTimeMs: 100_000, triesUsed: 2, tileScore: 5 };
    expect(compareTimedWordleSessions(a, b)).toBeGreaterThan(0);
  });

  it("falls to tile score (higher better) when time and tries are tied", () => {
    const a = { id: 1, found: false, cumulativeTimeMs: 360_000, triesUsed: 6, tileScore: 4 };
    const b = { id: 2, found: false, cumulativeTimeMs: 360_000, triesUsed: 6, tileScore: 8 };
    expect(compareTimedWordleSessions(a, b)).toBeGreaterThan(0);
  });

  it("falls to ascending id as the final fallback", () => {
    const a = { id: 5, found: false, cumulativeTimeMs: 360_000, triesUsed: 6, tileScore: 4 };
    const b = { id: 3, found: false, cumulativeTimeMs: 360_000, triesUsed: 6, tileScore: 4 };
    expect(compareTimedWordleSessions(a, b)).toBeGreaterThan(0);
  });
});
