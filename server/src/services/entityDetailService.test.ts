import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { getEntityWithLogs, getPersonProfile } from "./entityDetailService.js";

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
});
