import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog, updateLog, deleteLog, getLogById, getAlbumsForLogs } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { createAlbum, addAlbumEvent, removeAlbumEvent } from "./albumService.js";

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
    expect(log.photos).toEqual([]);
  });

  it("attaches a new log to an existing entity via entityId", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "eating_out", "Chipotle");
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

  it("defaults autoDelete to false and round-trips it through create and update", () => {
    ctx = createTestDb();
    const created = createLog(ctx.db, {
      category: "appointment",
      title: "Dentist",
      rating: null,
      date: "2024-06-20",
      notes: null,
      people: [],
    });
    expect(created.autoDelete).toBe(false);

    const flagged = updateLog(ctx.db, created.id, {
      rating: null,
      date: "2024-06-20",
      notes: null,
      people: [],
      autoDelete: true,
    });
    expect(flagged.autoDelete).toBe(true);
    expect(getLogById(ctx.db, created.id).autoDelete).toBe(true);
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

  it("reports album membership on the entity-detail path and clears it on unlink", () => {
    ctx = createTestDb();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 4,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    expect(getLogById(ctx.db, log.id).albums).toEqual([]);

    const a1 = createAlbum(ctx.db, { title: "One", eventLogIds: [log.id] });
    const a2 = addAlbumEvent(ctx.db, createAlbum(ctx.db, { title: "Two" }).id, log.id);
    const refs = getLogById(ctx.db, log.id).albums.map((a) => a.title).sort();
    expect(refs).toEqual(["One", "Two"]);

    removeAlbumEvent(ctx.db, a1.id, log.id);
    expect(getLogById(ctx.db, log.id).albums).toEqual([{ id: a2.id, title: "Two" }]);
  });

  it("getAlbumsForLogs batches by logId and guards empty input", () => {
    ctx = createTestDb();
    const l1 = createLog(ctx.db, { category: "movie", title: "A", rating: null, date: "2024-01-01", notes: null, people: [] });
    const l2 = createLog(ctx.db, { category: "movie", title: "B", rating: null, date: "2024-01-01", notes: null, people: [] });
    const album = createAlbum(ctx.db, { title: "Grp", eventLogIds: [l1.id] });

    expect(getAlbumsForLogs(ctx.db, [])).toEqual(new Map());
    const map = getAlbumsForLogs(ctx.db, [l1.id, l2.id]);
    expect(map.get(l1.id)).toEqual([{ id: album.id, title: "Grp" }]);
    expect(map.has(l2.id)).toBe(false);
  });
});
