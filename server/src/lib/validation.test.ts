import { describe, it, expect } from "vitest";
import {
  createLogSchema,
  updateLogSchema,
  searchQuerySchema,
  galleryQuerySchema,
  createEntityNoteSchema,
  calendarRangeQuerySchema,
} from "./validation.js";

describe("createLogSchema", () => {
  it("accepts a log against an existing entity and defaults rating/notes/people", () => {
    const parsed = createLogSchema.parse({ entityId: 3, date: "2024-01-01" });
    expect(parsed).toMatchObject({ entityId: 3, rating: null, notes: null, people: [] });
  });

  it("accepts category + title for a new entity", () => {
    expect(() =>
      createLogSchema.parse({ category: "movie", title: "Heat", date: "2024-01-01" }),
    ).not.toThrow();
  });

  it("rejects when neither entityId nor category+title is given", () => {
    expect(() => createLogSchema.parse({ date: "2024-01-01" })).toThrow(
      /Either entityId or category\+title/,
    );
  });

  it("rejects a non-loggable category", () => {
    expect(() =>
      createLogSchema.parse({ category: "person", title: "Sam", date: "2024-01-01" }),
    ).toThrow();
  });

  it("rejects an out-of-range or non-integer rating", () => {
    expect(() => createLogSchema.parse({ entityId: 1, date: "2024-01-01", rating: 6 })).toThrow();
    expect(() => createLogSchema.parse({ entityId: 1, date: "2024-01-01", rating: 2.5 })).toThrow();
  });

  it("requires a non-empty date", () => {
    expect(() => createLogSchema.parse({ entityId: 1, date: "" })).toThrow();
  });

  it("does NOT coerce a numeric-string rating (JSON body, not query string)", () => {
    expect(() => createLogSchema.parse({ entityId: 1, date: "2024-01-01", rating: "4" })).toThrow();
  });
});

describe("updateLogSchema", () => {
  it("requires a date and defaults the rest", () => {
    expect(updateLogSchema.parse({ date: "2024-02-02" })).toEqual({
      date: "2024-02-02",
      rating: null,
      notes: null,
      people: [],
      autoDelete: false,
    });
    expect(() => updateLogSchema.parse({})).toThrow();
  });
});

describe("searchQuerySchema", () => {
  it("coerces numeric query-string params", () => {
    const parsed = searchQuerySchema.parse({ ratingMin: "4", releaseYearMax: "2020" });
    expect(parsed.ratingMin).toBe(4);
    expect(parsed.releaseYearMax).toBe(2020);
  });

  it("rejects a non-numeric rating and out-of-range values", () => {
    expect(() => searchQuerySchema.parse({ ratingMin: "abc" })).toThrow();
    expect(() => searchQuerySchema.parse({ ratingMin: "0" })).toThrow();
    expect(() => searchQuerySchema.parse({ releaseYearMin: "1700" })).toThrow();
  });

  it("rejects unknown enum values", () => {
    expect(() => searchQuerySchema.parse({ groupBy: "nonsense" })).toThrow();
  });
});

describe("galleryQuerySchema", () => {
  it("defaults limit to 50 and coerces cursor", () => {
    expect(galleryQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(galleryQuerySchema.parse({ cursor: "123" }).cursor).toBe(123);
  });

  it("rejects limit above 100 or below 1", () => {
    expect(() => galleryQuerySchema.parse({ limit: "0" })).toThrow();
    expect(() => galleryQuerySchema.parse({ limit: "500" })).toThrow();
  });
});

describe("createEntityNoteSchema", () => {
  it("requires body for a general note", () => {
    expect(() => createEntityNoteSchema.parse({ category: "general", body: "" })).toThrow(
      /body is required/,
    );
  });

  it("requires tag + eventDate for an important_date note", () => {
    expect(() =>
      createEntityNoteSchema.parse({ category: "important_date", body: "" }),
    ).toThrow(/tag is required/);
    expect(() =>
      createEntityNoteSchema.parse({ category: "important_date", tag: "Birthday" }),
    ).toThrow(/eventDate is required/);
    expect(() =>
      createEntityNoteSchema.parse({
        category: "important_date",
        tag: "Birthday",
        eventDate: "1990-06-01",
      }),
    ).not.toThrow();
  });
});

describe("calendarRangeQuerySchema", () => {
  it("accepts a valid same-month range", () => {
    expect(calendarRangeQuerySchema.parse({ from: "2024-08-01", to: "2024-08-31" })).toEqual({
      from: "2024-08-01",
      to: "2024-08-31",
    });
  });

  it("rejects a missing param, wrong format, impossible date, reversed order, or oversized range", () => {
    expect(() => calendarRangeQuerySchema.parse({ from: "2024-08-01" })).toThrow();
    expect(() => calendarRangeQuerySchema.parse({ from: "2024-8-1", to: "2024-08-31" })).toThrow();
    expect(() => calendarRangeQuerySchema.parse({ from: "2024-13-01", to: "2024-13-05" })).toThrow();
    expect(() => calendarRangeQuerySchema.parse({ from: "2023-02-29", to: "2023-03-01" })).toThrow();
    expect(() => calendarRangeQuerySchema.parse({ from: "2024-08-31", to: "2024-08-01" })).toThrow();
    expect(() => calendarRangeQuerySchema.parse({ from: "2024-01-01", to: "2024-06-01" })).toThrow();
  });
});
