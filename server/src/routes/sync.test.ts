import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { createLog, updateLog, deleteLog } from "../services/logService.js";
import { findOrCreateEntity } from "../services/entityService.js";
import { createEntityNote } from "../services/entityNotesService.js";
import { createAlbum, addAlbumEvent } from "../services/albumService.js";
import type { MutationEnvelope, MutationResult, SyncChangesResponse } from "@logger/shared";

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

  it("serves the change-feed with Cache-Control: no-store", async () => {
    const app = setup();
    const res = await request(app).get("/api/sync/changes?since=0");
    expect(res.headers["cache-control"]).toBe("no-store");
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

describe("POST /api/sync/mutations", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }

  const mutate = async (
    app: ReturnType<typeof createApp>,
    mutations: MutationEnvelope[],
  ): Promise<MutationResult[]> => {
    const res = await request(app).post("/api/sync/mutations").send({ mutations });
    expect(res.status).toBe(200);
    return res.body.results as MutationResult[];
  };

  const changesNow = async (app: ReturnType<typeof createApp>) => {
    const res = await request(app).get("/api/sync/changes?since=0");
    expect(res.status).toBe(200);
    return res.body as SyncChangesResponse;
  };

  it("creates an entity, returns its temp→real idMap, and is idempotent on replay", async () => {
    const app = setup();
    const batch: MutationEnvelope[] = [
      { mutationId: "m1", type: "entity.create", tempId: -1, payload: { category: "movie", title: "Heat" } },
    ];

    const [first] = await mutate(app, batch);
    expect(first).toMatchObject({ mutationId: "m1", status: "applied" });
    const realId = first.idMap?.[-1];
    expect(realId).toEqual(expect.any(Number));
    expect(realId).toBeGreaterThan(0);

    // Replaying the same mutationId returns the stored result and creates nothing new.
    const [replayed] = await mutate(app, batch);
    expect(replayed).toEqual(first);

    const body = await changesNow(app);
    expect(body.changes.entities.filter((e) => e.title === "Heat")).toHaveLength(1);
  });

  it("resolves an intra-batch temp entityId on a following log.create", async () => {
    const app = setup();
    const results = await mutate(app, [
      { mutationId: "e", type: "entity.create", tempId: -1, payload: { category: "movie", title: "Heat" } },
      { mutationId: "l", type: "log.create", tempId: -2, payload: { entityId: -1, date: "2024-01-01", rating: 5 } },
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    const entityId = results[0].idMap?.[-1];
    const logId = results[1].idMap?.[-2];

    const body = await changesNow(app);
    const log = body.changes.logs.find((l) => l.id === logId);
    expect(log).toMatchObject({ entityId, rating: 5 });
  });

  it("resolves a temp person id inside log.create people[]", async () => {
    const app = setup();
    const results = await mutate(app, [
      { mutationId: "p", type: "entity.create", tempId: -2, payload: { category: "person", title: "Sam" } },
      {
        mutationId: "l",
        type: "log.create",
        tempId: -3,
        payload: { category: "movie", title: "Heat", date: "2024-01-01", people: [{ id: -2 }] },
      },
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    const personId = results[0].idMap?.[-2];
    const logId = results[1].idMap?.[-3];

    const body = await changesNow(app);
    expect(body.changes.logs.find((l) => l.id === logId)?.peopleIds).toEqual([personId]);
  });

  it("collapses entity.create onto an existing row via normalized-title dedup", async () => {
    const app = setup();
    const existing = findOrCreateEntity(ctx.db, "eating_out", "Chipotle");

    const [r] = await mutate(app, [
      { mutationId: "m1", type: "entity.create", tempId: -1, payload: { category: "eating_out", title: "  chipotle " } },
    ]);
    expect(r.status).toBe("applied");
    expect(r.idMap?.[-1]).toBe(existing.id);
  });

  it("applies a stale-baseVersion update but flags it as a conflict", async () => {
    const app = setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 3,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    const v1 = (await changesNow(app)).changes.logs[0].version;
    updateLog(ctx.db, log.id, { rating: 4, date: "2024-01-01", notes: "server edit", people: [] });
    const v2 = (await changesNow(app)).changes.logs[0].version;
    expect(v2).toBeGreaterThan(v1);

    const batch: MutationEnvelope[] = [
      {
        mutationId: "u1",
        type: "log.update",
        baseVersion: v1,
        payload: { logId: log.id, rating: 5, date: "2024-01-01", notes: "offline edit", people: [] },
      },
    ];
    const [r] = await mutate(app, batch);
    expect(r).toMatchObject({ mutationId: "u1", status: "conflict" });
    expect(r.serverVersion).toBeGreaterThan(v2);

    // Last write wins — the offline value is on the server.
    expect((await changesNow(app)).changes.logs[0]).toMatchObject({ rating: 5, notes: "offline edit" });

    // Replay returns the same conflict result.
    expect((await mutate(app, batch))[0]).toEqual(r);
  });

  it("skips log.update / note.update against a missing row", async () => {
    const app = setup();
    const [r] = await mutate(app, [
      { mutationId: "u", type: "log.update", payload: { logId: 987654, date: "2024-01-01", people: [] } },
    ]);
    expect(r).toMatchObject({ mutationId: "u", status: "skipped" });
  });

  it("handles log.delete with deletePhotos:true and delete-of-already-deleted", async () => {
    const app = setup();
    const a = createLog(ctx.db, {
      category: "movie",
      title: "One",
      rating: 3,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    const b = createLog(ctx.db, {
      category: "movie",
      title: "Two",
      rating: 3,
      date: "2024-01-01",
      notes: null,
      people: [],
    });
    deleteLog(ctx.db, b.id); // already gone before its envelope arrives

    const results = await mutate(app, [
      { mutationId: "d1", type: "log.delete", payload: { logId: a.id, deletePhotos: true } },
      { mutationId: "d2", type: "log.delete", payload: { logId: b.id } },
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);

    const body = await changesNow(app);
    expect(body.changes.logs.map((l) => l.id)).not.toContain(a.id);
  });

  it("isolates a poison envelope — it errors, later envelopes still apply, and it isn't re-run", async () => {
    const app = setup();
    const results = await mutate(app, [
      // -99 was never created in this batch → unresolved temp id → throws → error.
      { mutationId: "bad", type: "log.create", tempId: -1, payload: { entityId: -99, date: "2024-01-01" } },
      { mutationId: "good", type: "entity.create", tempId: -2, payload: { category: "movie", title: "Survivor" } },
    ]);
    expect(results[0]).toMatchObject({ mutationId: "bad", status: "error" });
    expect(results[0].error).toBeTruthy();
    expect(results[1]).toMatchObject({ mutationId: "good", status: "applied" });

    expect((await changesNow(app)).changes.entities.filter((e) => e.title === "Survivor")).toHaveLength(1);

    // Replay: the poison result is served from cache, the good one is deduped.
    const replay = await mutate(app, [
      { mutationId: "bad", type: "log.create", tempId: -1, payload: { entityId: -99, date: "2024-01-01" } },
      { mutationId: "good", type: "entity.create", tempId: -2, payload: { category: "movie", title: "Survivor" } },
    ]);
    expect(replay[0].status).toBe("error");
    expect(replay[1]).toEqual(results[1]);
    expect((await changesNow(app)).changes.entities.filter((e) => e.title === "Survivor")).toHaveLength(1);
  });

  it("preserves array order in the results", async () => {
    const app = setup();
    const batch: MutationEnvelope[] = ["a", "b", "c", "d", "e"].map((id, i) => ({
      mutationId: id,
      type: "entity.create" as const,
      tempId: -(i + 1),
      payload: { category: "movie", title: `Movie ${id}` },
    }));
    const results = await mutate(app, batch);
    expect(results.map((r) => r.mutationId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(results.every((r) => r.status === "applied")).toBe(true);
  });

  it("400s on a malformed batch", async () => {
    const app = setup();
    expect((await request(app).post("/api/sync/mutations").send({})).status).toBe(400);
    expect(
      (await request(app).post("/api/sync/mutations").send({ mutations: [{ type: "log.create" }] })).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/sync/mutations")
          .send({ mutations: [{ mutationId: "x", type: "nope.bad", payload: {} }] })
      ).status,
    ).toBe(400);
  });
});

describe("POST /api/sync/mutations — persistence across batches", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }
  const mutate = async (app: ReturnType<typeof createApp>, mutations: MutationEnvelope[]) => {
    const res = await request(app).post("/api/sync/mutations").send({ mutations });
    expect(res.status).toBe(200);
    return res.body.results as MutationResult[];
  };
  const changesNow = async (app: ReturnType<typeof createApp>) => {
    const res = await request(app).get("/api/sync/changes?since=0");
    expect(res.status).toBe(200);
    return res.body as SyncChangesResponse;
  };

  it("a create in batch 1 is still there — and editable by real id — in batch 2", async () => {
    const app = setup();
    const b1 = await mutate(app, [
      { mutationId: "e1", type: "entity.create", tempId: -1, payload: { category: "movie", title: "Sicario" } },
      {
        mutationId: "l1",
        type: "log.create",
        tempId: -2,
        payload: { entityId: -1, date: "2024-01-01", notes: "first pass", people: [] },
      },
    ]);
    const entityId = b1[0].idMap![-1];
    const logId = b1[1].idMap![-2];

    // A completely separate batch (fresh idMap) edits the row by its real id + adds a note.
    const b2 = await mutate(app, [
      {
        mutationId: "u1",
        type: "log.update",
        payload: { logId, date: "2024-01-01", notes: "revised", people: [] },
      },
      { mutationId: "n1", type: "note.create", tempId: -1, payload: { entityId, body: "a note" } },
    ]);
    expect(b2.map((r) => r.status)).toEqual(["applied", "applied"]);

    const feed = await changesNow(app);
    expect(feed.changes.entities.filter((e) => e.id === entityId)).toHaveLength(1);
    expect(feed.changes.logs.find((l) => l.id === logId)).toMatchObject({ notes: "revised" });
    expect(feed.changes.entityNotes.find((n) => n.entityId === entityId)).toMatchObject({ body: "a note" });
  });

  it("a delete in a later batch leaves a tombstone and drops the row from the feed", async () => {
    const app = setup();
    const [e, l] = await mutate(app, [
      { mutationId: "e", type: "entity.create", tempId: -1, payload: { category: "movie", title: "Gone" } },
      { mutationId: "l", type: "log.create", tempId: -2, payload: { entityId: -1, date: "2024-01-01", people: [] } },
    ]);
    const logId = l.idMap![-2];
    void e;

    await mutate(app, [{ mutationId: "d", type: "log.delete", payload: { logId } }]);

    const feed = await changesNow(app);
    expect(feed.changes.logs.some((row) => row.id === logId)).toBe(false);
    expect(feed.deletions).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityType: "log", id: logId })]),
    );
  });

  it("album event links made across two batches persist on both sides", async () => {
    const app = setup();
    const b1 = await mutate(app, [
      { mutationId: "e", type: "entity.create", tempId: -1, payload: { category: "movie", title: "Trip Film" } },
      { mutationId: "l", type: "log.create", tempId: -2, payload: { entityId: -1, date: "2024-01-01", people: [] } },
      { mutationId: "a", type: "album.create", tempId: -3, payload: { title: "Road Trip", eventLogIds: [], people: [] } },
    ]);
    const logId = b1[1].idMap![-2];
    const albumId = b1[2].idMap![-3];

    await mutate(app, [
      { mutationId: "ae", type: "album.addEvent", payload: { albumId, logId } },
      { mutationId: "ap", type: "album.addPerson", tempId: -1, payload: { albumId, person: { name: "Pat" } } },
    ]);

    const feed = await changesNow(app);
    expect(feed.changes.albums.find((x) => x.id === albumId)?.eventLogIds).toEqual([logId]);
    expect(feed.changes.logs.find((x) => x.id === logId)?.albumIds).toEqual([albumId]);
    const pat = feed.changes.entities.find((x) => x.title === "Pat");
    expect(feed.changes.albums.find((x) => x.id === albumId)?.personIds).toEqual([pat!.id]);
  });

  it("replaying batch 1 after batch 2 does not regress or duplicate the newer state", async () => {
    const app = setup();
    const batch1: MutationEnvelope[] = [
      { mutationId: "e", type: "entity.create", tempId: -1, payload: { category: "eating_out", title: "Chipotle" } },
      {
        mutationId: "l",
        type: "log.create",
        tempId: -2,
        payload: { entityId: -1, date: "2024-01-01", notes: "v1", people: [] },
      },
    ];
    const r1 = await mutate(app, batch1);
    const entityId = r1[0].idMap![-1];
    const logId = r1[1].idMap![-2];

    await mutate(app, [
      { mutationId: "u", type: "log.update", payload: { logId, date: "2024-01-01", notes: "v2", people: [] } },
    ]);

    // A retry of the whole first batch (offline client didn't get the 200).
    const replay = await mutate(app, batch1);
    expect(replay.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(replay[0].idMap![-1]).toBe(entityId);
    expect(replay[1].idMap![-2]).toBe(logId);

    const feed = await changesNow(app);
    expect(feed.changes.entities.filter((e) => e.title === "Chipotle")).toHaveLength(1);
    expect(feed.changes.logs.filter((l) => l.entityId === entityId)).toHaveLength(1);
    expect(feed.changes.logs.find((l) => l.id === logId)?.notes).toBe("v2"); // not clobbered back to v1
  });

  it("note create → update → delete across three batches ends deleted, with a tombstone", async () => {
    const app = setup();
    const [ent] = await mutate(app, [
      { mutationId: "e", type: "entity.create", tempId: -1, payload: { category: "person", title: "Robin" } },
    ]);
    const entityId = ent.idMap![-1];

    const [noteRes] = await mutate(app, [
      { mutationId: "nc", type: "note.create", tempId: -1, payload: { entityId, body: "draft" } },
    ]);
    const noteId = noteRes.idMap![-1];

    await mutate(app, [
      { mutationId: "nu", type: "note.update", payload: { noteId, body: "final" } },
    ]);
    expect((await changesNow(app)).changes.entityNotes.find((n) => n.id === noteId)?.body).toBe("final");

    await mutate(app, [{ mutationId: "nd", type: "note.delete", payload: { noteId } }]);

    const feed = await changesNow(app);
    expect(feed.changes.entityNotes.some((n) => n.id === noteId)).toBe(false);
    expect(feed.deletions).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityType: "entity_note", id: noteId })]),
    );
  });

  it("resolves an out-of-order dependency by deferring the envelope", async () => {
    const app = setup();
    // album.create references a person whose entity.create comes LATER in the batch.
    const results = await mutate(app, [
      {
        mutationId: "a",
        type: "album.create",
        tempId: -1,
        payload: { title: "Ordered Late", eventLogIds: [], people: [{ id: -2 }] },
      },
      { mutationId: "p", type: "entity.create", tempId: -2, payload: { category: "person", title: "Latecomer" } },
    ]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    const albumId = results[0].idMap![-1];
    const personId = results[1].idMap![-2];

    const feed = await changesNow(app);
    expect(feed.changes.albums.find((x) => x.id === albumId)?.personIds).toEqual([personId]);
    // Replaying the same (still out-of-order) batch is a no-op.
    const replay = await mutate(app, [
      {
        mutationId: "a",
        type: "album.create",
        tempId: -1,
        payload: { title: "Ordered Late", eventLogIds: [], people: [{ id: -2 }] },
      },
      { mutationId: "p", type: "entity.create", tempId: -2, payload: { category: "person", title: "Latecomer" } },
    ]);
    expect(replay.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect((await changesNow(app)).changes.entities.filter((e) => e.title === "Latecomer")).toHaveLength(1);
  });

  it("a genuinely unresolvable temp id still errors after the deferral passes", async () => {
    const app = setup();
    const [bad, good] = await mutate(app, [
      { mutationId: "bad", type: "log.create", tempId: -1, payload: { entityId: -77, date: "2024-01-01", people: [] } },
      { mutationId: "good", type: "entity.create", tempId: -2, payload: { category: "movie", title: "Fine" } },
    ]);
    expect(bad.status).toBe("error");
    expect(good.status).toBe("applied");
    expect((await changesNow(app)).changes.entities.filter((e) => e.title === "Fine")).toHaveLength(1);
  });

  it("a large single batch of creates all persist with distinct real ids", async () => {
    const app = setup();
    const batch: MutationEnvelope[] = Array.from({ length: 40 }, (_, i) => ({
      mutationId: `m${i}`,
      type: "entity.create" as const,
      tempId: -(i + 1),
      payload: { category: "movie", title: `Bulk ${i}` },
    }));
    const results = await mutate(app, batch);
    expect(results.every((r) => r.status === "applied")).toBe(true);

    const realIds = results.map((r) => Object.values(r.idMap!)[0]);
    expect(new Set(realIds).size).toBe(40);
    expect(realIds.every((id) => id > 0)).toBe(true);

    const feed = await changesNow(app);
    for (let i = 0; i < 40; i++) {
      expect(feed.changes.entities.filter((e) => e.title === `Bulk ${i}`)).toHaveLength(1);
    }
  });
});
