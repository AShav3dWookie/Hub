import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  CATEGORY_FIELDS,
  CATEGORY_META,
  LOGGABLE_CATEGORIES,
  categoryHasRating,
  categorySupportsPhotos,
  isLoggableCategory,
  type Category,
} from "./categories.js";

describe("category tables", () => {
  it("gives every category a metadata entry", () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_META[category], `missing CATEGORY_META for ${category}`).toBeDefined();
      expect(CATEGORY_META[category].category).toBe(category);
      expect(CATEGORY_META[category].label).not.toBe("");
      expect(CATEGORY_META[category].icon).not.toBe("");
    }
  });

  it("gives every loggable category a field config", () => {
    for (const category of LOGGABLE_CATEGORIES) {
      expect(CATEGORY_FIELDS[category], `missing CATEGORY_FIELDS for ${category}`).toBeDefined();
    }
  });

  it("does not configure fields for a non-loggable category", () => {
    expect(Object.keys(CATEGORY_FIELDS)).not.toContain("person");
  });

  it("treats every loggable category as a member of CATEGORIES", () => {
    for (const category of LOGGABLE_CATEGORIES) {
      expect(CATEGORIES).toContain(category);
    }
  });

  it("only ever uses a known date granularity", () => {
    for (const category of LOGGABLE_CATEGORIES) {
      expect(["day", "year"]).toContain(CATEGORY_FIELDS[category].dateGranularity);
      expect(CATEGORY_FIELDS[category].dateLabel).not.toBe("");
    }
  });
});

describe("isLoggableCategory", () => {
  it("accepts every loggable category", () => {
    for (const category of LOGGABLE_CATEGORIES) {
      expect(isLoggableCategory(category)).toBe(true);
    }
  });

  it("rejects person, which has no logs of its own", () => {
    expect(isLoggableCategory("person")).toBe(false);
  });
});

describe("categorySupportsPhotos", () => {
  it.each(["movie", "eating_out", "hang_out"] as const)("allows photos on %s", (category) => {
    expect(categorySupportsPhotos(category)).toBe(true);
  });

  it.each(["tv", "book", "game", "appointment"] as const)("denies photos on %s", (category) => {
    expect(categorySupportsPhotos(category)).toBe(false);
  });

  it("denies photos on a non-loggable category", () => {
    expect(categorySupportsPhotos("person")).toBe(false);
  });

  it("stays tied to people-tagging support", () => {
    for (const category of LOGGABLE_CATEGORIES) {
      expect(categorySupportsPhotos(category)).toBe(CATEGORY_FIELDS[category].hasPeople);
    }
  });
});

describe("categoryHasRating", () => {
  it.each(["movie", "tv", "eating_out", "book", "game"] as const)("rates %s", (category) => {
    expect(categoryHasRating(category)).toBe(true);
  });

  it.each(["hang_out", "appointment"] as const)("does not rate %s", (category) => {
    expect(categoryHasRating(category)).toBe(false);
  });

  it("does not rate a non-loggable category", () => {
    expect(categoryHasRating("person")).toBe(false);
  });
});

describe("guards against an unknown category", () => {
  it("reports neither photos nor rating for a value outside the union", () => {
    const bogus = "not_a_category" as Category;
    expect(categorySupportsPhotos(bogus)).toBe(false);
    expect(categoryHasRating(bogus)).toBe(false);
  });
});
