import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../testUtils/testDb.js";
import { entities } from "../db/schema.js";
import { applyMutations } from "./syncMutationsService.js";
import { createLog, getLogById } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { createAlbum } from "./albumService.js";
import type { ParsedMutationEnvelope } from "../lib/syncValidation.js";

/**
 * The offline write replay, at the service level. `routes/sync.test.ts` covers it over HTTP;
 * these target the batch machinery itself — temp-id resolution, the deferral loop, idempotent
 * replay and the error shape — which is the most intricate code on the server.
 */
describe("applyMutations", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-sync-"));
    return ctx.db;
  }

  const run = (envelopes: ParsedMutationEnvelope[]) =>
    applyMutations(ctx.db, photosDir, envelopes);

  const env = (e: Partial<ParsedMutationEnvelope> & { type: ParsedMutationEnvelope["type"] }) =>
    ({ mutationId: `m-${Math.random().toString(36).slice(2)}`, payload: {}, ...e }) as
      ParsedMutationEnvelope;

  it("creates an entity and reports its real id against the temp one", () => {
    setup();
    const [result] = run([
      env({
        mutationId: "m1",
        type: "entity.create",
        tempId: -1,
        payload: { category: "movie", title: "Dune" },
      }),
    ]);

    expect(result.status).toBe("applied");
    expect(result.idMap?.[-1]).toBeGreaterThan(0);
  });

  it("resolves a temp id referenced by a later mutation in the same batch", () => {
    setup();
    const results = run([
      env({
        mutationId: "m1",
        type: "entity.create",
        tempId: -1,
        payload: { category: "movie", title: "Dune" },
      }),
      env({
        mutationId: "m2",
        type: "log.create",
        tempId: -2,
        payload: { entityId: -1, rating: 5, date: "2026-01-01", notes: null, people: [] },
      }),
    ]);

    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    const logId = results[1].idMap?.[-2];
    expect(logId).toBeGreaterThan(0);
    expect(getLogById(ctx.db, logId!).rating).toBe(5);
  });

  it("still lands a batch whose dependency arrives out of order", () => {
    setup();
    // The log references an entity created *later* in the batch. The deferral loop retries it.
    const results = run([
      env({
        mutationId: "m2",
        type: "log.create",
        tempId: -2,
        payload: { entityId: -1, rating: 4, date: "2026-01-01", notes: null, people: [] },
      }),
      env({
        mutationId: "m1",
        type: "entity.create",
        tempId: -1,
        payload: { category: "movie", title: "Dune" },
      }),
    ]);

    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
  });

  it("returns results in the order they were sent, not the order they were applied", () => {
    setup();
    const results = run([
      env({
        mutationId: "first",
        type: "log.create",
        tempId: -2,
        payload: { entityId: -1, rating: 4, date: "2026-01-01", notes: null, people: [] },
      }),
      env({
        mutationId: "second",
        type: "entity.create",
        tempId: -1,
        payload: { category: "movie", title: "Dune" },
      }),
    ]);

    expect(results.map((r) => r.mutationId)).toEqual(["first", "second"]);
  });

  it("gives up on a temp id that nothing in the batch ever creates", () => {
    setup();
    const [result] = run([
      env({
        mutationId: "m1",
        type: "log.create",
        payload: { entityId: -99, rating: 4, date: "2026-01-01", notes: null, people: [] },
      }),
    ]);

    expect(result.status).toBe("error");
    expect(result.error).toBeTruthy();
  });

  it("replays a mutation id without applying it twice", () => {
    setup();
    const envelope = env({
      mutationId: "same-id",
      type: "entity.create",
      tempId: -1,
      payload: { category: "movie", title: "Dune" },
    });

    const first = run([envelope]);
    const second = run([envelope]);

    expect(second[0]).toEqual(first[0]);
    expect(second[0].idMap?.[-1]).toBe(first[0].idMap?.[-1]);

    // One entity, not two, despite the duplicate delivery.
    const dunes = ctx.db.select().from(entities).all().filter((e) => e.title === "Dune");
    expect(dunes).toHaveLength(1);
  });

  it("treats deleting an already-deleted row as done, so a replay drains the queue", () => {
    setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Dune",
      rating: 4,
      date: "2026-01-01",
      notes: null,
      people: [],
    });

    const first = run([env({ mutationId: "d1", type: "log.delete", payload: { logId: log.id } })]);
    const second = run([env({ mutationId: "d2", type: "log.delete", payload: { logId: log.id } })]);

    expect(first[0].status).toBe("applied");
    expect(second[0].status).toBe("applied");
  });

  it("skips a link against a row that is gone rather than failing the batch", () => {
    setup();
    const [result] = run([
      env({ mutationId: "a1", type: "album.addEvent", payload: { albumId: 9999, logId: 9999 } }),
    ]);

    expect(result.status).toBe("skipped");
  });

  it("skips an update to a row that no longer exists", () => {
    setup();
    const [result] = run([
      env({
        mutationId: "u1",
        type: "log.update",
        payload: { logId: 9999, rating: 3, date: "2026-01-01", notes: null, people: [] },
      }),
    ]);

    expect(result.status).toBe("skipped");
  });

  it("applies an update and reports the new server version", () => {
    setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Dune",
      rating: 4,
      date: "2026-01-01",
      notes: null,
      people: [],
    });

    const [result] = run([
      env({
        mutationId: "u1",
        type: "log.update",
        baseVersion: 1,
        payload: { logId: log.id, rating: 2, date: "2026-01-01", notes: null, people: [] },
      }),
    ]);

    expect(result.status).toBe("applied");
    expect(result.serverVersion).toBeGreaterThan(0);
    expect(getLogById(ctx.db, log.id).rating).toBe(2);
  });

  it("flags a conflict when the client edited an older version, but still writes", () => {
    setup();
    const log = createLog(ctx.db, {
      category: "movie",
      title: "Dune",
      rating: 4,
      date: "2026-01-01",
      notes: null,
      people: [],
    });
    // Someone else updates it first, moving the server version on.
    run([
      env({
        mutationId: "server-side",
        type: "log.update",
        payload: { logId: log.id, rating: 5, date: "2026-01-01", notes: null, people: [] },
      }),
    ]);

    const [result] = run([
      env({
        mutationId: "stale",
        type: "log.update",
        baseVersion: 0,
        payload: { logId: log.id, rating: 1, date: "2026-01-01", notes: null, people: [] },
      }),
    ]);

    expect(result.status).toBe("conflict");
    expect(getLogById(ctx.db, log.id).rating).toBe(1); // last write still wins
  });

  it("reports a bad payload as an error carrying the reason, not as a crash", () => {
    setup();
    const [result] = run([
      env({ mutationId: "bad", type: "log.delete", payload: { logId: "not-a-number" } }),
    ]);

    expect(result.status).toBe("error");
    expect(result.error).toBeTruthy();
    expect(typeof result.error).toBe("string");
  });

  it("keeps applying the rest of a batch after one envelope fails", () => {
    setup();
    const results = run([
      env({ mutationId: "bad", type: "log.delete", payload: { logId: "nope" } }),
      env({
        mutationId: "good",
        type: "entity.create",
        tempId: -1,
        payload: { category: "movie", title: "Dune" },
      }),
    ]);

    expect(results[0].status).toBe("error");
    expect(results[1].status).toBe("applied");
  });

  it("handles an empty batch", () => {
    setup();
    expect(run([])).toEqual([]);
  });

  it("applies a note create against an entity created in the same batch", () => {
    setup();
    const results = run([
      env({
        mutationId: "e1",
        type: "entity.create",
        tempId: -1,
        payload: { category: "person", title: "Ada" },
      }),
      env({
        mutationId: "n1",
        type: "note.create",
        tempId: -2,
        payload: {
          entityId: -1,
          category: "important_date",
          body: "",
          tag: "Birthday",
          eventDate: "1990-09-03",
        },
      }),
    ]);

    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
  });

  it("removes an album person that was added earlier in the same batch", () => {
    setup();
    const album = createAlbum(ctx.db, {
      title: "Rome",
      notes: null,
      dateStart: null,
      dateEnd: null,
    });
    const ada = findOrCreateEntity(ctx.db, "person", "Ada");

    const results = run([
      env({
        mutationId: "p1",
        type: "album.addPerson",
        payload: { albumId: album.id, person: { id: ada.id } },
      }),
      env({
        mutationId: "p2",
        type: "album.removePerson",
        payload: { albumId: album.id, personId: ada.id },
      }),
    ]);

    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
  });
});
