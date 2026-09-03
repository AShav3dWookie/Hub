import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { logPhotos } from "../db/schema.js";
import { createLog, deleteLog } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { createEntityNote } from "./entityNotesService.js";
import { createAlbum } from "./albumService.js";
import { DEFAULT_SYNC_LIMIT, getChanges } from "./syncService.js";

/**
 * The change-feed at the service level. `routes/sync.test.ts` drives it over HTTP; these cover
 * the paging boundary and the per-table partitioning directly, which the route tests only reach
 * incidentally.
 */
describe("getChanges", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  const seedLog = (title: string) =>
    createLog(ctx.db, {
      category: "movie",
      title,
      rating: 4,
      date: "2026-01-01",
      notes: null,
      people: [],
    });

  it("returns nothing from an empty database, but still advances the cursor", () => {
    ctx = createTestDb();
    const page = getChanges(ctx.db);

    expect(page.changes.entities).toEqual([]);
    expect(page.changes.logs).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(Number(page.nextCursor)).toBeGreaterThanOrEqual(0);
  });

  it("partitions rows into the table they came from", () => {
    ctx = createTestDb();
    const person = findOrCreateEntity(ctx.db, "person", "Ada");
    seedLog("Dune");
    createEntityNote(ctx.db, person.id, { category: "general", body: "likes sci-fi" });
    createAlbum(ctx.db, { title: "Rome", notes: null, dateStart: null, dateEnd: null });

    const page = getChanges(ctx.db);
    expect(page.changes.entities.length).toBeGreaterThan(0);
    expect(page.changes.logs).toHaveLength(1);
    expect(page.changes.entityNotes).toHaveLength(1);
    expect(page.changes.albums).toHaveLength(1);
  });

  it("maps a photo row to its public urls", () => {
    ctx = createTestDb();
    const log = seedLog("Dune");
    ctx.db
      .insert(logPhotos)
      .values({
        logId: log.id,
        albumId: null,
        filename: "abc.jpg",
        thumbnailFilename: "abc_thumb.webp",
        originalName: "holiday.jpg",
        mimeType: "image/jpeg",
        size: 2048,
      })
      .run();

    const [photo] = getChanges(ctx.db).changes.photos;
    expect(photo).toMatchObject({
      logId: log.id,
      albumId: null,
      url: "/api/photos/abc.jpg",
      thumbnailUrl: "/api/photos/abc_thumb.webp",
      originalName: "holiday.jpg",
      mimeType: "image/jpeg",
      size: 2048,
    });
  });

  it("reports a deleted row as a tombstone rather than an upsert", () => {
    ctx = createTestDb();
    const log = seedLog("Dune");
    const afterCreate = Number(getChanges(ctx.db).nextCursor);

    deleteLog(ctx.db, log.id);

    const page = getChanges(ctx.db, { since: afterCreate });
    expect(page.changes.logs).toEqual([]);
    expect(page.deletions).toHaveLength(1);
    expect(page.deletions[0]).toMatchObject({ entityType: "log", id: log.id });
  });

  it("returns only what changed after the cursor", () => {
    ctx = createTestDb();
    seedLog("Dune");
    const cursor = Number(getChanges(ctx.db).nextCursor);

    seedLog("Arrival");

    const page = getChanges(ctx.db, { since: cursor });
    expect(page.changes.logs).toHaveLength(1);
    expect(page.changes.entities.map((e) => e.title)).toContain("Arrival");
  });

  it("advances the cursor even when nothing changed, so the next poll stays cheap", () => {
    ctx = createTestDb();
    seedLog("Dune");
    const first = Number(getChanges(ctx.db).nextCursor);

    const second = getChanges(ctx.db, { since: first });
    expect(second.changes.logs).toEqual([]);
    expect(Number(second.nextCursor)).toBeGreaterThanOrEqual(first);
    expect(second.hasMore).toBe(false);
  });

  it("flags more pages when the window is full", () => {
    ctx = createTestDb();
    seedLog("Dune");
    seedLog("Arrival");

    const page = getChanges(ctx.db, { limit: 1 });
    expect(page.hasMore).toBe(true);
    expect(Number(page.nextCursor)).toBeGreaterThan(0);
  });

  it("does not flag more pages when the window exactly fits", () => {
    ctx = createTestDb();
    const log = seedLog("Dune");
    const total = getChanges(ctx.db).changes.entities.length + 1; // its entity plus the log

    const page = getChanges(ctx.db, { limit: total });
    expect(page.hasMore).toBe(false);
    expect(page.changes.logs.map((l) => l.id)).toEqual([log.id]);
  });

  it("pages through everything once, in order, with no repeats or gaps", () => {
    ctx = createTestDb();
    for (const title of ["Dune", "Arrival", "Solaris", "Stalker", "Annihilation"]) {
      seedLog(title);
    }

    const seenLogs: number[] = [];
    const seenEntities: number[] = [];
    let cursor = 0;

    for (let guard = 0; guard < 50; guard++) {
      const page = getChanges(ctx.db, { since: cursor, limit: 2 });
      seenLogs.push(...page.changes.logs.map((l) => l.id));
      seenEntities.push(...page.changes.entities.map((e) => e.id));
      cursor = Number(page.nextCursor);
      if (!page.hasMore) break;
    }

    expect(seenLogs).toHaveLength(5);
    expect(new Set(seenLogs).size).toBe(5);
    expect(new Set(seenEntities).size).toBe(seenEntities.length);
    // A full drain must leave nothing behind.
    expect(getChanges(ctx.db, { since: cursor }).changes.logs).toEqual([]);
  });

  it("orders each group by its row sequence, oldest first", () => {
    ctx = createTestDb();
    seedLog("Dune");
    seedLog("Arrival");
    seedLog("Solaris");

    const logs = getChanges(ctx.db).changes.logs;
    const seqs = logs.map((l) => l.rowSeq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("defaults to a page size of DEFAULT_SYNC_LIMIT", () => {
    ctx = createTestDb();
    seedLog("Dune");
    expect(DEFAULT_SYNC_LIMIT).toBe(500);
    expect(getChanges(ctx.db).hasMore).toBe(false);
  });

  it("carries the version of each row so the client can detect a conflict", () => {
    ctx = createTestDb();
    const log = seedLog("Dune");
    const [synced] = getChanges(ctx.db).changes.logs;
    expect(synced.id).toBe(log.id);
    expect(typeof synced.version).toBe("number");
    expect(typeof synced.rowSeq).toBe("number");
  });
});
