import { describe, it, expect } from "vitest";
import { normalizeTitle } from "./normalize.js";

describe("normalizeTitle", () => {
  it("lowercases and trims", () => {
    expect(normalizeTitle("  Chipotle ")).toBe("chipotle");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeTitle("The   Grand\tBudapest   Hotel")).toBe("the grand budapest hotel");
  });

  it("treats case/whitespace variants of the same title as equal", () => {
    expect(normalizeTitle("chipotle")).toBe(normalizeTitle("  CHIPOTLE  "));
  });

  it("leaves punctuation and diacritics intact", () => {
    expect(normalizeTitle("Amélie: Le Fabuleux Destin")).toBe("amélie: le fabuleux destin");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeTitle("   \t  ")).toBe("");
  });
});
