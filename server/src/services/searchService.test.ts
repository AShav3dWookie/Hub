import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog } from "./logService.js";
import { search } from "./searchService.js";

describe("searchService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  function seed() {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "eating_out",
      title: "Chipotle",
      rating: 4,
      date: "2024-01-01",
      notes: "Grabbed lunch in Edinburgh before the movie.",
      people: [{ name: "Sarah" }],
    });
    createLog(ctx.db, {
      category: "eating_out",
      title: "Chipotle",
      rating: 5,
      date: "2024-06-01",
      notes: null,
      people: [{ name: "Jamie" }],
    });
    createLog(ctx.db, {
      category: "movie",
      title: "Inception",
      rating: 3,
      date: "2024-03-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });
  }

  it("groups by entity by default, nesting all matching logs per entity", () => {
    seed();
    const result = search(ctx.db, {});
    expect(result.groupBy).toBe("entity");
    const chipotle = result.entities!.find((e) => e.title === "Chipotle")!;
    expect(chipotle.visitCount).toBe(2);
    expect(chipotle.averageRating).toBe(4.5);
    expect(chipotle.logs).toHaveLength(2);
  });

  it("filters by category", () => {
    seed();
    const result = search(ctx.db, { category: "movie" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("Inception");
  });

  it("filters by keyword against title", () => {
    seed();
    const result = search(ctx.db, { q: "chip" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("Chipotle");
  });

  it("filters by keyword against notes", () => {
    seed();
    const result = search(ctx.db, { q: "edinburgh" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("Chipotle");
    expect(result.entities![0].logs).toHaveLength(1);
    expect(result.entities![0].logs[0].date).toBe("2024-01-01");
  });

  it("filters by keyword against a tagged person's name across categories", () => {
    seed();
    const result = search(ctx.db, { q: "jamie" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("Chipotle");
    expect(result.entities![0].logs).toHaveLength(1);
  });

  it("requires all words to match by default (AND mode)", () => {
    seed();
    // "chipotle" matches the title, "jamie" only matches the second Chipotle log's person.
    const result = search(ctx.db, { q: "chipotle jamie" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].logs).toHaveLength(1);
    expect(result.entities![0].logs[0].date).toBe("2024-06-01");
  });

  it("matches any word when qMode is 'any'", () => {
    seed();
    // "jamie" matches the second Chipotle log, "sarah" matches the first Chipotle log and Inception.
    const result = search(ctx.db, { q: "jamie sarah", qMode: "any", groupBy: "log" });
    expect(result.logs).toHaveLength(3);
  });

  it("filters by rating range", () => {
    seed();
    const result = search(ctx.db, { ratingMin: 5 });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("Chipotle");
    expect(result.entities![0].logs).toHaveLength(1);
    expect(result.entities![0].logs[0].rating).toBe(5);
  });

  it("sorts nested visits within an entity via visitSortBy", () => {
    seed();
    const result = search(ctx.db, { visitSortBy: "date", visitSortOrder: "asc" });
    const chipotle = result.entities!.find((e) => e.title === "Chipotle")!;
    expect(chipotle.logs.map((l) => l.date)).toEqual(["2024-01-01", "2024-06-01"]);
  });

  it("returns a flat log list sorted by rating when groupBy=log", () => {
    seed();
    const result = search(ctx.db, { groupBy: "log", sortBy: "rating", sortOrder: "asc" });
    expect(result.logs).toHaveLength(3);
    expect(result.logs!.map((l) => l.rating)).toEqual([3, 4, 5]);
    expect(result.logs![0].entity.title).toBe("Inception");
  });

  it("matches a person by name in keyword search and reports their appearance count", () => {
    seed();
    const result = search(ctx.db, { q: "sarah" });
    expect(result.people).toHaveLength(1);
    expect(result.people![0].name).toBe("Sarah");
    expect(result.people![0].appearanceCount).toBe(2);
  });

  it("suppresses person matches when a specific non-person category filter is active", () => {
    seed();
    const result = search(ctx.db, { q: "sarah", category: "movie" });
    expect(result.people).toEqual([]);
    // The keyword still matches Inception's tagged person, so entity results are unaffected.
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("Inception");
  });

  it("lists all people alphabetically when filtering by the person category with no keyword", () => {
    seed();
    const result = search(ctx.db, { category: "person" });
    expect(result.people!.map((p) => p.name)).toEqual(["Jamie", "Sarah"]);
    expect(result.entities).toEqual([]);
  });

  it("returns no people when there is no keyword and no person category filter", () => {
    seed();
    const result = search(ctx.db, {});
    expect(result.people).toEqual([]);
  });

  it("filters by author (case-insensitive contains)", () => {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "book",
      title: "Dune",
      author: "Frank Herbert",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    createLog(ctx.db, {
      category: "book",
      title: "Foundation",
      author: "Isaac Asimov",
      rating: 4,
      date: "2024-02-01",
      notes: null,
      people: [],
    });

    const result = search(ctx.db, { authorContains: "herbert" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("Dune");
  });

  it("filters by release year range", () => {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "movie",
      title: "Old Movie",
      releaseYear: 1985,
      rating: 3,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    createLog(ctx.db, {
      category: "movie",
      title: "New Movie",
      releaseYear: 2020,
      rating: 4,
      date: "2024-02-01",
      notes: null,
      people: [],
    });

    const result = search(ctx.db, { releaseYearMin: 2000, releaseYearMax: 2025 });
    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].title).toBe("New Movie");
  });
});
