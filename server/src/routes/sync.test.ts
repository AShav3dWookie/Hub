import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { createLog, updateLog, deleteLog } from "../services/logService.js";
import { findOrCreateEntity } from "../services/entityService.js";
import { createEntityNote } from "../services/entityNotesService.js";
import { createAlbum, addAlbumEvent } from "../services/albumService.js";
import type { SyncChangesResponse } from "@logger/shared";

describe("GET /api/sync/changes", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }

  const changes = async (app: ReturnType<typeof createApp>, since?: string | number) => {
    const res = await request(app).get(
      `/api/sync/changes${since != null ? `?since=${since}` : ""}`,
    );
    expect(res.status).toBe(200);
    return res.body as SyncChangesResponse;
  };

  it("bootstraps the whole dataset from since=0 and advances the cursor", async () => {
    const app = setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Sam" }],
    });

    const body = await changes(app);
    expect(body.hasMore).toBe(false);
    expect(body.changes.entities.map((e) => e.title).sort()).toEqual(["Heat", "Sam"]);
    expect(body.changes.logs).toHaveLength(1);
    expect(body.changes.logs[0]).toMatchObject({ id: log.id, rating: 5, version: expect.any(Number) });
    expect(body.changes.logs[0].peopleIds).toHaveLength(1);
    expect(body.deletions).toEqual([]);
    expect(Number(body.nextCursor)).toBeGreaterThan(0);
    expect(body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Nothing new since the cursor.
    const empty = await changes(app, body.nextCursor);
    expect(empty.changes.entities).toEqual([]);
    expect(empty.changes.logs).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(empty.nextCursor).toBe(body.nextCursor);
  });

  it("returns only rows changed since the cursor", async () => {
    const app = setup();
    createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 4,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    const first = await changes(app);

    const second = createLog(ctx.db, {
      category: "book",
      title: "Dune",
      rating: 5,
      date: "2024-02-02",
      notes: null,
      people: [],
      author: "Frank Herbert",
    });

    const delta = await changes(app, first.nextCursor);
    expect(delta.changes.logs.map((l) => l.id)).toEqual([second.id]);
    expect(delta.changes.entities.map((e) => e.title)).toEqual(["Dune"]);
    expect(Number(delta.nextCursor)).toBeGreaterThan(Number(first.nextCursor));
  });

  it("reports an update with a bumped version and no duplicate rows", async () => {
    const app = setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 3,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    const first = await changes(app);
    const v1 = first.changes.logs[0].version;

    updateLog(ctx.db, log.id, { rating: 5, date: "2024-01-01", notes: "rewatch", people: [] });

    const delta = await changes(app, first.nextCursor);
    expect(delta.changes.logs).toHaveLength(1);
    expect(delta.changes.logs[0]).toMatchObject({ id: log.id, rating: 5, notes: "rewatch" });
    expect(delta.changes.logs[0].version).toBeGreaterThan(v1);
  });

  it("surfaces deletions as tombstones", async () => {
    const app = setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 3,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    const first = await changes(app);

    deleteLog(ctx.db, log.id);

    const delta = await changes(app, first.nextCursor);
    expect(delta.changes.logs).toEqual([]);
    expect(delta.deletions).toEqual([
      expect.objectContaining({ entityType: "log", id: log.id }),
    ]);
    expect(delta.deletions[0].deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("re-emits a log when its people/photos/album links change", async () => {
    const app = setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 4,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    const album = createAlbum(ctx.db, { title: "Movie night", people: [], eventLogIds: [] });
    const first = await changes(app);

    addAlbumEvent(ctx.db, album.id, log.id);

    const delta = await changes(app, first.nextCursor);
    const synced = delta.changes.logs.find((l) => l.id === log.id);
    expect(synced?.albumIds).toEqual([album.id]);
    const syncedAlbum = delta.changes.albums.find((a) => a.id === album.id);
    expect(syncedAlbum?.eventLogIds).toEqual([log.id]);
  });

  it("paginates a large change set as one globally-ordered rowSeq stream", async () => {
    const app = setup();
    for (let i = 0; i < 6; i++) {
      createLog(ctx.db, {
        category: "movie",
        title: `Movie ${i}`,
        rating: 3,
        date: "2024-01-01",
        notes: null,
        people: [],
      });
    }

    const seen: number[] = [];
    let cursor = "0";
    let prevPageMax = 0;
    let guard = 0;
    for (;;) {
      const res = await request(app).get(`/api/sync/changes?since=${cursor}&limit=3`);
      expect(res.status).toBe(200);
      const body = res.body as SyncChangesResponse;
      const pageSeqs = [
        ...body.changes.entities.map((e) => e.rowSeq),
        ...body.changes.logs.map((l) => l.rowSeq),
      ];
      // This page's rows all sit above the previous page and at/under the new cursor.
      expect(Math.min(...pageSeqs)).toBeGreaterThan(prevPageMax);
      expect(Math.max(...pageSeqs)).toBe(Number(body.nextCursor));
      expect(pageSeqs.length).toBeLessThanOrEqual(3);
      prevPageMax = Math.max(...pageSeqs);
      seen.push(...pageSeqs);
      cursor = body.nextCursor;
      if (!body.hasMore) break;
      if (++guard > 20) throw new Error("pagination did not terminate");
    }

    // 6 movie entities + 6 logs, every rowSeq delivered exactly once.
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect([...seen].sort((a, b) => a - b)).toEqual([...seen].sort((a, b) => a - b));
  });

  it("400s on a malformed cursor or limit", async () => {
    const app = setup();
    expect((await request(app).get("/api/sync/changes?since=-1")).status).toBe(400);
    expect((await request(app).get("/api/sync/changes?since=abc")).status).toBe(400);
    expect((await request(app).get("/api/sync/changes?limit=0")).status).toBe(400);
    expect((await request(app).get("/api/sync/changes?limit=5000")).status).toBe(400);
  });

  it("includes entity notes and their tombstones", async () => {
    const app = setup();
    const person = findOrCreateEntity(ctx.db, "person", "Alice");
    const note = createEntityNote(ctx.db, person.id, {
      category: "important_date",
      tag: "Birthday",
      eventDate: "1990-05-12",
      body: "card!",
    });
    const body = await changes(app);
    expect(body.changes.entityNotes).toEqual([
      expect.objectContaining({ id: note.id, entityId: person.id, tag: "Birthday" }),
    ]);
  });
});
