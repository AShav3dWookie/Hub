import { describe, it, expect } from "vitest";
import { matchesTokens, tokenizeQuery } from "./search.js";

describe("tokenizeQuery", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenizeQuery("Blade Runner")).toEqual(["blade", "runner"]);
  });

  it("collapses runs of mixed whitespace", () => {
    expect(tokenizeQuery("  the   grand\tbudapest\nhotel ")).toEqual([
      "the",
      "grand",
      "budapest",
      "hotel",
    ]);
  });

  it("returns no tokens for an empty or whitespace-only query", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   \t ")).toEqual([]);
  });

  it("keeps punctuation inside a token", () => {
    expect(tokenizeQuery("wall-e amélie:")).toEqual(["wall-e", "amélie:"]);
  });
});

describe("matchesTokens", () => {
  it("requires every token by default", () => {
    expect(matchesTokens("The Grand Budapest Hotel", ["grand", "hotel"])).toBe(true);
    expect(matchesTokens("The Grand Budapest Hotel", ["grand", "casino"])).toBe(false);
  });

  it("requires every token in all mode", () => {
    expect(matchesTokens("The Grand Budapest Hotel", ["grand", "hotel"], "all")).toBe(true);
    expect(matchesTokens("The Grand Budapest Hotel", ["grand", "casino"], "all")).toBe(false);
  });

  it("requires only one token in any mode", () => {
    expect(matchesTokens("The Grand Budapest Hotel", ["grand", "casino"], "any")).toBe(true);
    expect(matchesTokens("The Grand Budapest Hotel", ["casino", "diner"], "any")).toBe(false);
  });

  it("matches case-insensitively in both directions", () => {
    expect(matchesTokens("CHIPOTLE", ["chipotle"])).toBe(true);
    expect(matchesTokens("chipotle", ["CHIPOTLE"])).toBe(false);
  });

  it("matches on a substring, not only a whole word", () => {
    expect(matchesTokens("Budapest", ["buda"])).toBe(true);
  });

  it("matches everything when there are no tokens, in either mode", () => {
    expect(matchesTokens("anything at all", [])).toBe(true);
    expect(matchesTokens("anything at all", [], "any")).toBe(true);
    expect(matchesTokens("", [])).toBe(true);
  });

  it("never matches a non-empty token against an empty haystack", () => {
    expect(matchesTokens("", ["grand"])).toBe(false);
    expect(matchesTokens("", ["grand"], "any")).toBe(false);
  });
});
