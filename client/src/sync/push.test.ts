import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushOutbox } from "./push.js";
import { getDB, type OutboxRecord } from "../local/db.js";
import { listOutbox, pendingOutbox } from "../local/outbox.js";
import { makeAlbum, makeEntity, makeLog, resetFixtureCounters } from "../test/seedLocalDb.js";

function outboxRec(
  over: Partial<OutboxRecord> & Pick<OutboxRecord, "mutationId" | "seq" | "type">,
): OutboxRecord {
  return {
    payload: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    attempts: 0,
    status: "pending",
    affects: [],
    ...over,
  };
}

/** Two queued creates: a temp entity (-1) and a temp log (-2) that references it. */
async function seedTwoCreates() {
  const db = await getDB();
  await db.put("entities", { ...makeEntity({ id: -1, title: "Heat" }), _localDirty: true });
  await db.put("logs", { ...makeLog({ id: -2, entityId: -1 }), _localDirty: true });
  const tx = db.transaction("outbox", "readwrite");
  await tx.store.put(
    outboxRec({
      mutationId: "e",
      seq: 1,
      type: "entity.create",
      tempId: -1,
      payload: { category: "movie", title: "Heat" },
      affects: [{ store: "entities", id: -1 }],
    }),
  );
  await tx.store.put(
    outboxRec({
      mutationId: "l",
      seq: 2,
      type: "log.create",
      tempId: -2,
      payload: { entityId: -1, date: "2024-01-01", people: [] },
      affects: [{ store: "logs", id: -2 }],
    }),
  );
  await tx.done;
}

function fetchReturning(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(() =>
    Promise.resolve({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body }),
  );
}

describe("pushOutbox", () => {
  beforeEach(() => {
    resetFixtureCounters();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("flushes the queue, reconciles temp ids, and clears the dirty flags", async () => {
    await seedTwoCreates();
    const fetchMock = fetchReturning({
      results: [
        { mutationId: "e", status: "applied", idMap: { "-1": 100 } },
        { mutationId: "l", status: "applied", idMap: { "-2": 200 } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushOutbox();

    expect(result).toEqual({ pushed: 2, dead: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await listOutbox()).toEqual([]);

    const db = await getDB();
    expect((await db.getAll("entities")).map((e) => e.id)).toEqual([100]);
    const log = (await db.getAll("logs"))[0];
    expect(log).toMatchObject({ id: 200, entityId: 100 });
    expect(log._localDirty).toBeUndefined();
  });

  it("does nothing when offline — queue intact", async () => {
    await seedTwoCreates();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = fetchReturning({ results: [] });
    vi.stubGlobal("fetch", fetchMock);

    expect(await pushOutbox()).toEqual({ pushed: 0, dead: 0, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await pendingOutbox()).toHaveLength(2);
  });

  it("leaves the queue intact on a 401", async () => {
    await seedTwoCreates();
    vi.stubGlobal("fetch", fetchReturning({ error: "no session" }, { ok: false, status: 401 }));

    expect(await pushOutbox()).toEqual({ pushed: 0, dead: 0, error: "auth" });
    expect(await pendingOutbox()).toHaveLength(2);
  });

  it("leaves the queue intact on a network error", async () => {
    await seedTwoCreates();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    expect(await pushOutbox()).toEqual({ pushed: 0, dead: 0, error: "network" });
    expect(await pendingOutbox()).toHaveLength(2);
  });

  it("dead-letters a rejected envelope and drains the rest", async () => {
    await seedTwoCreates();
    vi.stubGlobal(
      "fetch",
      fetchReturning({
        results: [
          { mutationId: "e", status: "applied", idMap: { "-1": 100 } },
          { mutationId: "l", status: "error", error: "bad payload" },
        ],
      }),
    );

    expect(await pushOutbox()).toEqual({ pushed: 1, dead: 1 });
    const rows = await listOutbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mutationId: "l", status: "dead", error: "bad payload" });
    expect((await (await getDB()).getAll("entities")).map((e) => e.id)).toEqual([100]);
  });

  it("treats a conflict as accepted and removes it from the queue", async () => {
    const db = await getDB();
    await db.put("logs", { ...makeLog({ id: 5, entityId: 1, version: 3 }), _localDirty: true });
    const tx = db.transaction("outbox", "readwrite");
    await tx.store.put(
      outboxRec({
        mutationId: "u",
        seq: 1,
        type: "log.update",
        baseVersion: 3,
        payload: { logId: 5, date: "2024-01-01", people: [] },
        affects: [{ store: "logs", id: 5 }],
      }),
    );
    await tx.done;
    vi.stubGlobal(
      "fetch",
      fetchReturning({ results: [{ mutationId: "u", status: "conflict", serverVersion: 9 }] }),
    );

    expect(await pushOutbox()).toEqual({ pushed: 1, dead: 0 });
    expect(await listOutbox()).toEqual([]);
    expect((await db.getAll("logs"))[0]._localDirty).toBeUndefined();
  });

  it("a second push cycle keeps the first cycle's reconciled ids and links", async () => {
    const db = await getDB();
    // Cycle 1: create a temp entity + its log.
    await seedTwoCreates();
    vi.stubGlobal(
      "fetch",
      fetchReturning({
        results: [
          { mutationId: "e", status: "applied", idMap: { "-1": 100 } },
          { mutationId: "l", status: "applied", idMap: { "-2": 200 } },
        ],
      }),
    );
    expect(await pushOutbox()).toEqual({ pushed: 2, dead: 0 });
    expect((await db.getAll("entities")).map((e) => e.id)).toEqual([100]);
    expect((await db.getAll("logs"))[0]).toMatchObject({ id: 200, entityId: 100 });

    // Cycle 2: offline the user makes a NEW album that links the now-real log, plus edits it.
    await db.put("albums", {
      ...makeAlbum({ id: -3, eventLogIds: [200] }),
      _localDirty: true,
    });
    const log = (await db.getAll("logs"))[0];
    await db.put("logs", { ...log, albumIds: [-3], notes: "with album", _localDirty: true });
    const tx = db.transaction("outbox", "readwrite");
    await tx.store.put(
      outboxRec({
        mutationId: "a",
        seq: 3,
        type: "album.create",
        tempId: -3,
        payload: { title: "Trip", eventLogIds: [200], people: [] },
        affects: [
          { store: "albums", id: -3 },
          { store: "logs", id: 200 },
        ],
      }),
    );
    await tx.store.put(
      outboxRec({
        mutationId: "u2",
        seq: 4,
        type: "log.update",
        payload: { logId: 200, date: "2024-01-01", notes: "with album", people: [] },
        affects: [{ store: "logs", id: 200 }],
      }),
    );
    await tx.done;

    vi.stubGlobal(
      "fetch",
      fetchReturning({
        results: [
          { mutationId: "a", status: "applied", idMap: { "-3": 300 } },
          { mutationId: "u2", status: "applied" },
        ],
      }),
    );
    expect(await pushOutbox()).toEqual({ pushed: 2, dead: 0 });

    // First cycle's ids are untouched; the album re-keyed and the link survives on both sides.
    expect((await db.getAll("entities")).map((e) => e.id)).toEqual([100]);
    expect((await db.getAll("albums"))[0]).toMatchObject({ id: 300, eventLogIds: [200] });
    const finalLog = (await db.getAll("logs"))[0];
    expect(finalLog).toMatchObject({ id: 200, entityId: 100, albumIds: [300], notes: "with album" });
    expect(finalLog._localDirty).toBeUndefined();
    expect(await listOutbox()).toEqual([]);
  });
});
