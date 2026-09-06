import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { getEntityWithLogs, getPersonProfile } from "./entityDetailService.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

describe("entityDetailService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("aggregates visit count, average rating, and latest date for an entity", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "eating_out", "Chipotle");
    createLog(ctx.db, { entityId: entity.id, rating: 4, date: "2024-01-01", notes: null, people: [] });
    createLog(ctx.db, { entityId: entity.id, rating: 2, date: "2024-06-01", notes: null, people: [] });

    const result = getEntityWithLogs(ctx.db, entity.id);
    expect(result.visitCount).toBe(2);
    expect(result.averageRating).toBe(3);
    expect(result.latestDate).toBe("2024-06-01");
    expect(result.logs[0].date).toBe("2024-06-01"); // sorted newest first by default
  });

  it("builds a person profile with appearances across categories and stats", () => {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "movie",
      title: "Inception",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });
    createLog(ctx.db, {
      category: "movie",
      title: "Arrival",
      rating: 4,
      date: "2024-02-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });
    createLog(ctx.db, {
      category: "eating_out",
      title: "Chipotle",
      rating: 3,
      date: "2024-03-01",
      notes: null,
      people: [{ name: "Sarah" }, { name: "Jamie" }],
    });

    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    const profile = getPersonProfile(ctx.db, sarah.id);

    expect(profile.entity.title).toBe("Sarah");
    expect(profile.appearances).toHaveLength(3);
    expect(profile.stats.totalLogs).toBe(3);
    expect(profile.stats.favoriteCategory).toBe("movie");
    expect(profile.stats.mostFrequentCoPerson?.name).toBe("Jamie");
  });

  it("refuses to treat a person as a loggable entity", () => {
    ctx = createTestDb();
    const person = findOrCreateEntity(ctx.db, "person", "Sarah");
    expect(() => getEntityWithLogs(ctx.db, person.id)).toThrow(BadRequestError);
    expect(() => getEntityWithLogs(ctx.db, person.id)).toThrow(/person profile endpoint/);
  });

  it("refuses to build a person profile for something that is not a person", () => {
    ctx = createTestDb();
    const movie = findOrCreateEntity(ctx.db, "movie", "Inception");
    expect(() => getPersonProfile(ctx.db, movie.id)).toThrow(BadRequestError);
    expect(() => getPersonProfile(ctx.db, movie.id)).toThrow(/not a person/);
  });

  it("reports a 404 for an entity that does not exist", () => {
    ctx = createTestDb();
    expect(() => getEntityWithLogs(ctx.db, 9999)).toThrow(NotFoundError);
    expect(() => getPersonProfile(ctx.db, 9999)).toThrow(NotFoundError);
  });

  it("reports a null average rating when an entity has no rated logs", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "hang_out", "Bowling");
    createLog(ctx.db, {
      entityId: entity.id,
      rating: null,
      date: "2024-01-01",
      notes: null,
      people: [],
    });

    const result = getEntityWithLogs(ctx.db, entity.id);
    expect(result.visitCount).toBe(1);
    expect(result.averageRating).toBeNull();
    expect(result.latestDate).toBe("2024-01-01");
  });

  it("averages only the rated logs, ignoring the unrated ones", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "eating_out", "Chipotle");
    createLog(ctx.db, { entityId: entity.id, rating: 4, date: "2024-01-01", notes: null, people: [] });
    createLog(ctx.db, { entityId: entity.id, rating: null, date: "2024-02-01", notes: null, people: [] });

    expect(getEntityWithLogs(ctx.db, entity.id).averageRating).toBe(4);
  });

  it("reports an entity with no logs at all as empty rather than failing", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "movie", "Unwatched");

    const result = getEntityWithLogs(ctx.db, entity.id);
    expect(result).toMatchObject({ visitCount: 0, averageRating: null, latestDate: null });
    expect(result.logs).toEqual([]);
  });

  it("reports empty stats for a person who has never been tagged", () => {
    ctx = createTestDb();
    const person = findOrCreateEntity(ctx.db, "person", "Nobody");

    const profile = getPersonProfile(ctx.db, person.id);
    expect(profile.appearances).toEqual([]);
    expect(profile.stats).toEqual({
      totalLogs: 0,
      favoriteCategory: null,
      mostFrequentCoPerson: null,
    });
  });

  it("reports no co-person when someone is only ever tagged alone", () => {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "movie",
      title: "Solo Trip",
      rating: 3,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });

    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    const profile = getPersonProfile(ctx.db, sarah.id);
    expect(profile.stats.totalLogs).toBe(1);
    expect(profile.stats.mostFrequentCoPerson).toBeNull();
  });

  it("breaks a favourite-category tie alphabetically rather than by row order", () => {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "movie",
      title: "Inception",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });
    createLog(ctx.db, {
      category: "eating_out",
      title: "Chipotle",
      rating: 3,
      date: "2024-02-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });

    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    expect(getPersonProfile(ctx.db, sarah.id).stats.favoriteCategory).toBe("eating_out");
  });

  it("leaves appearances without photos, so a profile never triggers a per-log lookup", () => {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "movie",
      title: "Inception",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });

    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    const profile = getPersonProfile(ctx.db, sarah.id);
    expect(profile.appearances[0].photos).toEqual([]);
    expect(profile.appearances[0].albums).toEqual([]);
  });
});
