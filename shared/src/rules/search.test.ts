import { describe, it, expect } from "vitest";
import type { EntityWithLogsDTO, LogDTO, LogWithEntityDTO, PersonRef } from "../types.js";
import {
  comparator,
  entityMatchesFilters,
  logMatchesFilters,
  matchByTitle,
  peopleLabel,
  resolveSearchOptions,
  shouldSearchSideList,
  sortEntityLogs,
  sortEntityResults,
  sortLogResults,
  summariseEntityLogs,
} from "./search.js";

function logDTO(overrides: Partial<LogDTO> = {}): LogDTO {
  return {
    id: 1,
    entityId: 10,
    rating: null,
    date: "2026-09-03",
    notes: null,
    people: [],
    photos: [],
    albums: [],
    autoDelete: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const withEntity = (log: Partial<LogDTO>, title: string): LogWithEntityDTO =>
  ({
    ...logDTO(log),
    entity: { id: 10, category: "movie", title, createdAt: "", releaseYear: null, author: null },
  }) as LogWithEntityDTO;

const entityResult = (over: Partial<EntityWithLogsDTO>): EntityWithLogsDTO =>
  ({
    id: 1,
    category: "movie",
    title: "A",
    createdAt: "",
    releaseYear: null,
    author: null,
    logs: [],
    visitCount: 0,
    averageRating: null,
    latestDate: null,
    ...over,
  }) as EntityWithLogsDTO;

describe("resolveSearchOptions", () => {
  it("fills in every default", () => {
    expect(resolveSearchOptions({})).toEqual({
      groupBy: "entity",
      sortBy: "date",
      sortOrder: "desc",
      visitSortBy: "date",
      visitSortOrder: "desc",
      qMode: "all",
      tokens: [],
    });
  });

  it("keeps explicit values and tokenises the keyword", () => {
    const options = resolveSearchOptions({ q: "Blade Runner", qMode: "any", groupBy: "log" });
    expect(options.tokens).toEqual(["blade", "runner"]);
    expect(options.qMode).toBe("any");
    expect(options.groupBy).toBe("log");
  });

  it("produces no tokens for an empty keyword", () => {
    expect(resolveSearchOptions({ q: "" }).tokens).toEqual([]);
  });
});

describe("comparator", () => {
  it("sorts descending by default", () => {
    expect([1, 3, 2].sort(comparator())).toEqual([3, 2, 1]);
  });

  it("sorts ascending when asked", () => {
    expect([1, 3, 2].sort(comparator("asc"))).toEqual([1, 2, 3]);
  });

  it("treats equal values as tied", () => {
    expect(comparator("asc")(2, 2)).toBe(0);
  });

  it("orders strings too", () => {
    expect(["b", "a"].sort(comparator("asc"))).toEqual(["a", "b"]);
  });
});

describe("peopleLabel", () => {
  const people: PersonRef[] = [
    { id: 2, name: "Zoe" },
    { id: 1, name: "Ada" },
  ];

  it("joins names in name order, not id order", () => {
    expect(peopleLabel(people)).toBe("Ada, Zoe");
  });

  it("is empty for nobody", () => {
    expect(peopleLabel([])).toBe("");
  });
});

describe("entityMatchesFilters", () => {
  const movie = { category: "movie" as const, author: null, releaseYear: 1999 };

  it("excludes person entities when no category is asked for", () => {
    expect(entityMatchesFilters({ ...movie, category: "person" }, {})).toBe(false);
    expect(entityMatchesFilters(movie, {})).toBe(true);
  });

  it("includes person entities when the person tab is selected", () => {
    expect(entityMatchesFilters({ ...movie, category: "person" }, { category: "person" })).toBe(true);
  });

  it("filters to the requested category", () => {
    expect(entityMatchesFilters(movie, { category: "movie" })).toBe(true);
    expect(entityMatchesFilters(movie, { category: "book" })).toBe(false);
  });

  it("matches an author substring case-insensitively", () => {
    const book = { category: "book" as const, author: "Ursula K. Le Guin", releaseYear: null };
    expect(entityMatchesFilters(book, { authorContains: "le guin" })).toBe(true);
    expect(entityMatchesFilters(book, { authorContains: "URSULA" })).toBe(true);
    expect(entityMatchesFilters(book, { authorContains: "tolkien" })).toBe(false);
  });

  it("matches an accented author case-insensitively, which a SQL LIKE would not", () => {
    const book = { category: "book" as const, author: "Émile Zola", releaseYear: null };
    expect(entityMatchesFilters(book, { authorContains: "émile" })).toBe(true);
  });

  it("rejects a missing author when an author filter is set", () => {
    expect(entityMatchesFilters(movie, { authorContains: "anyone" })).toBe(false);
  });

  it("applies the release-year bounds inclusively", () => {
    expect(entityMatchesFilters(movie, { releaseYearMin: 1999 })).toBe(true);
    expect(entityMatchesFilters(movie, { releaseYearMax: 1999 })).toBe(true);
    expect(entityMatchesFilters(movie, { releaseYearMin: 2000 })).toBe(false);
    expect(entityMatchesFilters(movie, { releaseYearMax: 1998 })).toBe(false);
  });

  it("rejects a missing release year when a bound is set", () => {
    const noYear = { ...movie, releaseYear: null };
    expect(entityMatchesFilters(noYear, { releaseYearMin: 1900 })).toBe(false);
    expect(entityMatchesFilters(noYear, { releaseYearMax: 2100 })).toBe(false);
  });
});

describe("logMatchesFilters", () => {
  const context = { entityTitle: "Blade Runner", peopleNames: ["Ada"] };
  const none = { tokens: [] as string[], qMode: "all" as const };
  const log = { date: "2026-09-03", rating: 4, notes: "great" };

  it("applies the date bounds inclusively", () => {
    expect(logMatchesFilters(log, context, { dateFrom: "2026-09-03" }, none)).toBe(true);
    expect(logMatchesFilters(log, context, { dateTo: "2026-09-03" }, none)).toBe(true);
    expect(logMatchesFilters(log, context, { dateFrom: "2026-09-04" }, none)).toBe(false);
    expect(logMatchesFilters(log, context, { dateTo: "2026-09-02" }, none)).toBe(false);
  });

  it("applies the rating bounds inclusively", () => {
    expect(logMatchesFilters(log, context, { ratingMin: 4 }, none)).toBe(true);
    expect(logMatchesFilters(log, context, { ratingMax: 4 }, none)).toBe(true);
    expect(logMatchesFilters(log, context, { ratingMin: 5 }, none)).toBe(false);
  });

  it("excludes an unrated log whenever a rating bound is set", () => {
    const unrated = { ...log, rating: null };
    expect(logMatchesFilters(unrated, context, { ratingMin: 1 }, none)).toBe(false);
    expect(logMatchesFilters(unrated, context, { ratingMax: 5 }, none)).toBe(false);
    expect(logMatchesFilters(unrated, context, {}, none)).toBe(true);
  });

  it("matches the keyword against the entity title", () => {
    const opts = { tokens: ["blade"], qMode: "all" as const };
    expect(logMatchesFilters(log, context, {}, opts)).toBe(true);
  });

  it("matches the keyword against the notes", () => {
    const opts = { tokens: ["great"], qMode: "all" as const };
    expect(logMatchesFilters(log, context, {}, opts)).toBe(true);
  });

  it("matches the keyword against a tagged person's name", () => {
    const opts = { tokens: ["ada"], qMode: "all" as const };
    expect(logMatchesFilters(log, context, {}, opts)).toBe(true);
  });

  it("requires every token in all mode and any one in any mode", () => {
    const all = { tokens: ["blade", "nobody"], qMode: "all" as const };
    const any = { tokens: ["blade", "nobody"], qMode: "any" as const };
    expect(logMatchesFilters(log, context, {}, all)).toBe(false);
    expect(logMatchesFilters(log, context, {}, any)).toBe(true);
  });

  it("tolerates a log with no notes", () => {
    const opts = { tokens: ["blade"], qMode: "all" as const };
    expect(logMatchesFilters({ ...log, notes: null }, context, {}, opts)).toBe(true);
  });
});

describe("sortLogResults", () => {
  it("sorts by date, newest first by default", () => {
    const sorted = sortLogResults(
      [withEntity({ id: 1, date: "2026-01-01" }, "A"), withEntity({ id: 2, date: "2026-09-01" }, "B")],
      "date",
      "desc",
    );
    expect(sorted.map((l) => l.id)).toEqual([2, 1]);
  });

  it("sorts by title case-insensitively", () => {
    const sorted = sortLogResults(
      [withEntity({ id: 1 }, "zebra"), withEntity({ id: 2 }, "Apple")],
      "title",
      "asc",
    );
    expect(sorted.map((l) => l.id)).toEqual([2, 1]);
  });

  it("treats an unrated log as zero when sorting by rating", () => {
    const sorted = sortLogResults(
      [withEntity({ id: 1, rating: null }, "A"), withEntity({ id: 2, rating: 3 }, "B")],
      "rating",
      "desc",
    );
    expect(sorted.map((l) => l.id)).toEqual([2, 1]);
  });

  it("sorts by the joined people label", () => {
    const sorted = sortLogResults(
      [
        withEntity({ id: 1, people: [{ id: 9, name: "Zoe" }] }, "A"),
        withEntity({ id: 2, people: [{ id: 8, name: "Ada" }] }, "B"),
      ],
      "person",
      "asc",
    );
    expect(sorted.map((l) => l.id)).toEqual([2, 1]);
  });
});

describe("sortEntityLogs", () => {
  it("sorts an entity's own logs by date", () => {
    const sorted = sortEntityLogs(
      [logDTO({ id: 1, date: "2020-01-01" }), logDTO({ id: 2, date: "2026-01-01" })],
      "date",
      "desc",
    );
    expect(sorted.map((l) => l.id)).toEqual([2, 1]);
  });

  it("sorts by rating ascending", () => {
    const sorted = sortEntityLogs(
      [logDTO({ id: 1, rating: 5 }), logDTO({ id: 2, rating: 2 })],
      "rating",
      "asc",
    );
    expect(sorted.map((l) => l.id)).toEqual([2, 1]);
  });
});

describe("sortEntityResults", () => {
  it("sorts by latest date, and treats a null as earliest", () => {
    const sorted = sortEntityResults(
      [
        entityResult({ id: 1, latestDate: null }),
        entityResult({ id: 2, latestDate: "2026-01-01" }),
      ],
      "date",
      "desc",
    );
    expect(sorted.map((e) => e.id)).toEqual([2, 1]);
  });

  it("sorts by average rating, treating null as zero", () => {
    const sorted = sortEntityResults(
      [entityResult({ id: 1, averageRating: null }), entityResult({ id: 2, averageRating: 4 })],
      "rating",
      "desc",
    );
    expect(sorted.map((e) => e.id)).toEqual([2, 1]);
  });

  it("sorts by title case-insensitively", () => {
    const sorted = sortEntityResults(
      [entityResult({ id: 1, title: "zebra" }), entityResult({ id: 2, title: "Apple" })],
      "title",
      "asc",
    );
    expect(sorted.map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("summariseEntityLogs", () => {
  it("counts every log but averages only the rated ones", () => {
    const summary = summariseEntityLogs([
      logDTO({ rating: 4, date: "2026-01-01" }),
      logDTO({ rating: 2, date: "2026-05-01" }),
      logDTO({ rating: null, date: "2026-03-01" }),
    ]);
    expect(summary).toEqual({ visitCount: 3, averageRating: 3, latestDate: "2026-05-01" });
  });

  it("reports a null average when nothing is rated, never zero", () => {
    const summary = summariseEntityLogs([logDTO({ rating: null })]);
    expect(summary.averageRating).toBeNull();
  });

  it("reports nulls and a zero count for no logs", () => {
    expect(summariseEntityLogs([])).toEqual({
      visitCount: 0,
      averageRating: null,
      latestDate: null,
    });
  });
});

describe("shouldSearchSideList", () => {
  it("includes the side list for a keyword search with no category", () => {
    expect(shouldSearchSideList({}, ["ada"], "person")).toBe(true);
    expect(shouldSearchSideList({}, ["trip"], "album")).toBe(true);
  });

  it("excludes it for an empty keyword with no category", () => {
    expect(shouldSearchSideList({}, [], "person")).toBe(false);
  });

  it("lists it in full when browsing its own tab with no keyword", () => {
    expect(shouldSearchSideList({ category: "person" }, [], "person")).toBe(true);
    expect(shouldSearchSideList({ category: "album" }, [], "album")).toBe(true);
  });

  it("suppresses it when a different category tab is active", () => {
    expect(shouldSearchSideList({ category: "movie" }, ["ada"], "person")).toBe(false);
    expect(shouldSearchSideList({ category: "person" }, ["trip"], "album")).toBe(false);
  });
});

describe("matchByTitle", () => {
  const rows = [{ title: "Rome trip" }, { title: "Paris trip" }, { title: "Wedding" }];
  const titleOf = (r: { title: string }) => r.title;

  it("returns every row when there is no keyword", () => {
    expect(matchByTitle(rows, titleOf, { tokens: [], qMode: "all" })).toHaveLength(3);
  });

  it("filters by the keyword", () => {
    const matched = matchByTitle(rows, titleOf, { tokens: ["trip"], qMode: "all" });
    expect(matched.map(titleOf)).toEqual(["Rome trip", "Paris trip"]);
  });

  it("copies rather than aliasing the input", () => {
    const result = matchByTitle(rows, titleOf, { tokens: [], qMode: "all" });
    expect(result).not.toBe(rows);
  });
});
