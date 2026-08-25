import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog, updateLog, deleteLog, getLogById } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";

describe("logService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("creates a log against a new entity and auto-creates tagged people", () => {
    ctx = createTestDb();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "The Matrix",
      rating: 5,
      date: "2024-01-01",
      notes: "Great movie",
      people: [{ name: "Sarah" }],
    });

    expect(log.rating).toBe(5);
    expect(log.people).toHaveLength(1);
    expect(log.people[0].name).toBe("Sarah");
  });

  it("attaches a new log to an existing entity via entityId", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "restaurant", "Chipotle");
    const log = createLog(ctx.db, {
      entityId: entity.id,
      rating: 4,
      date: "2024-02-01",
      notes: null,
      people: [],
    });
    expect(log.entityId).toBe(entity.id);
  });

  it("reuses an existing person entity when tagging by id", () => {
    ctx = createTestDb();
    const person = findOrCreateEntity(ctx.db, "person", "Sarah");
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Arrival",
      rating: 4,
      date: "2024-01-01",
      notes: null,
      people: [{ id: person.id }],
    });
    expect(log.people).toEqual([{ id: person.id, name: "Sarah" }]);
  });

  it("rejects an out-of-range rating", () => {
    ctx = createTestDb();
    expect(() =>
      createLog(ctx.db, {
        category: "movie",
        title: "Bad Rating",
        rating: 6,
        date: "2024-01-01",
        notes: null,
        people: [],
      }),
    ).toThrow();
  });

  it("updates a log's fields and replaces tagged people", () => {
    ctx = createTestDb();
    const created = createLog(ctx.db, {
      category: "book",
      title: "Dune",
      rating: 3,
      date: "2024-01-01",
      notes: "first read",
      people: [{ name: "Alex" }],
    });

    const updated = updateLog(ctx.db, created.id, {
      rating: 5,
      date: "2024-03-01",
      notes: "reread, loved it more",
      people: [{ name: "Jamie" }],
    });

    expect(updated.rating).toBe(5);
    expect(updated.notes).toBe("reread, loved it more");
    expect(updated.people.map((p) => p.name)).toEqual(["Jamie"]);
  });

  it("deletes a log", () => {
    ctx = createTestDb();
    const created = createLog(ctx.db, {
      category: "game",
      title: "Portal",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    deleteLog(ctx.db, created.id);
    expect(() => getLogById(ctx.db, created.id)).toThrow();
  });
});
