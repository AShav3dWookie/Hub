import { describe, it, expect, beforeEach } from "vitest";
import { applyLocalMutation } from "./localMutations.js";
import { listOutbox, pendingOutbox } from "./outbox.js";
import { getDB, type LocalLog } from "./db.js";
import { loadSnapshot } from "./snapshot.js";
import {
  makeAlbum,
  makeEntity,
  makeLog,
  makeNote,
  makePerson,
  resetFixtureCounters,
  seedLocalDb,
} from "../test/seedLocalDb.js";

const store = async <T>(name: "entities" | "logs" | "albums" | "entityNotes"): Promise<T[]> =>
  (await (await getDB()).getAll(name)) as T[];

describe("applyLocalMutation", () => {
  beforeEach(() => resetFixtureCounters());

  describe("entity.create", () => {
    it("mints a temp entity row + an entity.create envelope", async () => {
      const { id } = await applyLocalMutation({
        type: "entity.create",
        input: { category: "movie", title: "Heat" },
      });
      expect(id).toBe(-1);

      const [row] = await store<{ id: number; _localDirty?: boolean; normalizedTitle: string }>("entities");
      expect(row).toMatchObject({ id: -1, normalizedTitle: "heat", _localDirty: true });

      const [env] = await listOutbox();
      expect(env).toMatchObject({
        type: "entity.create",
        tempId: -1,
        payload: { category: "movie", title: "Heat" },
        affects: [{ store: "entities", id: -1 }],
      });
    });

    it("collapses onto an existing local row by normalized title — no envelope", async () => {
      await seedLocalDb({ entities: [makeEntity({ id: 7, category: "eating_out", title: "Chipotle" })] });
      const { id } = await applyLocalMutation({
        type: "entity.create",
        input: { category: "eating_out", title: "  chipotle " },
      });
      expect(id).toBe(7);
      expect(await listOutbox()).toEqual([]);
    });
  });

  describe("log.create", () => {
    it("decomposes an inline title into entity.create + log.create", async () => {
      const row = await applyLocalMutation({
        type: "log.create",
        input: { category: "movie", title: "Heat", rating: 5, date: "2024-01-01", notes: null, people: [] },
      });
      expect(row).toMatchObject({ entityId: -1, rating: 5, _localDirty: true });

      const envs = await listOutbox();
      expect(envs.map((e) => e.type)).toEqual(["entity.create", "log.create"]);
      expect(envs[0].seq).toBeLessThan(envs[1].seq);
      expect(envs[1].payload).toMatchObject({ entityId: -1, people: [] });
    });

    it("decomposes a {name} person tag into a person entity.create", async () => {
      const row = await applyLocalMutation({
        type: "log.create",
        input: {
          entityId: 3,
          rating: null,
          date: "2024-02-02",
          notes: null,
          people: [{ name: "Sam" }],
        },
      });
      expect((row as LocalLog).peopleIds).toEqual([-1]);

      const envs = await listOutbox();
      expect(envs.map((e) => e.type)).toEqual(["entity.create", "log.create"]);
      expect(envs[0].payload).toMatchObject({ category: "person", title: "Sam" });
      expect(envs[1].payload).toMatchObject({ entityId: 3, people: [{ id: -1 }] });
    });

    it("keeps an existing person id and entity id as-is — one envelope", async () => {
      await seedLocalDb({ entities: [makeEntity({ id: 3 }), makePerson("Alex", { id: 9 })] });
      await applyLocalMutation({
        type: "log.create",
        input: { entityId: 3, rating: 4, date: "2024-03-03", notes: null, people: [{ id: 9 }] },
      });
      const envs = await listOutbox();
      expect(envs).toHaveLength(1);
      expect(envs[0].payload).toMatchObject({ entityId: 3, people: [{ id: 9 }] });
    });
  });

  describe("log.update", () => {
    it("replaces the row and queues an envelope carrying baseVersion", async () => {
      await seedLocalDb({ logs: [makeLog({ id: 5, entityId: 1, rating: 2, version: 4 })] });
      await applyLocalMutation({
        type: "log.update",
        input: { logId: 5, rating: 5, date: "2024-01-01", notes: "great", people: [] },
      });
      const [log] = await store<{ rating: number; notes: string; _localDirty?: boolean }>("logs");
      expect(log).toMatchObject({ rating: 5, notes: "great", _localDirty: true });

      const [env] = await listOutbox();
      expect(env).toMatchObject({ type: "log.update", baseVersion: 4, payload: { logId: 5, rating: 5 } });
    });

    it("collapses into a still-pending log.create for the same temp row", async () => {
      const created = await applyLocalMutation({
        type: "log.create",
        input: { entityId: 1, rating: 1, date: "2024-01-01", notes: null, people: [] },
      });
      const tempId = created.id;
      await applyLocalMutation({
        type: "log.update",
        input: { logId: tempId, rating: 5, date: "2024-01-01", notes: "edited", people: [] },
      });

      const envs = await listOutbox();
      expect(envs).toHaveLength(1);
      expect(envs[0]).toMatchObject({ type: "log.create", payload: { rating: 5, notes: "edited" } });
    });
  });

  describe("log.delete", () => {
    it("soft-deletes a real row (hidden from snapshots) and queues log.delete", async () => {
      await seedLocalDb({
        entities: [makeEntity({ id: 1 })],
        logs: [makeLog({ id: 5, entityId: 1, version: 2 })],
      });
      await applyLocalMutation({ type: "log.delete", input: { logId: 5, deletePhotos: false } });

      const [log] = await store<{ _localDeleted?: boolean }>("logs");
      expect(log._localDeleted).toBe(true);
      expect((await loadSnapshot()).logs).toEqual([]);

      const [env] = await listOutbox();
      expect(env).toMatchObject({ type: "log.delete", baseVersion: 2, payload: { logId: 5, deletePhotos: false } });
    });

    it("annihilates an un-synced temp log — row and its create envelope vanish", async () => {
      const created = await applyLocalMutation({
        type: "log.create",
        input: { category: "movie", title: "Temp", rating: null, date: "2024-01-01", notes: null, people: [] },
      });
      await applyLocalMutation({ type: "log.delete", input: { logId: created.id, deletePhotos: false } });

      expect(await store("logs")).toEqual([]);
      // only the entity.create for "Temp" remains
      expect((await listOutbox()).map((e) => e.type)).toEqual(["entity.create"]);
    });
  });

  describe("albums", () => {
    it("album.create links events on both sides and queues one envelope", async () => {
      await seedLocalDb({ logs: [makeLog({ id: 5, entityId: 1 })] });
      const album = await applyLocalMutation({
        type: "album.create",
        input: { title: "Trip", eventLogIds: [5], people: [] },
      });
      expect((album as { id: number }).id).toBe(-1);

      const [log] = await store<{ albumIds: number[] }>("logs");
      expect(log.albumIds).toEqual([-1]);

      const [env] = await listOutbox();
      expect(env).toMatchObject({ type: "album.create", tempId: -1, payload: { eventLogIds: [5] } });
    });

    it("album.addEvent updates eventLogIds and albumIds and queues album.addEvent", async () => {
      await seedLocalDb({
        albums: [makeAlbum({ id: 2, eventLogIds: [] })],
        logs: [makeLog({ id: 5, entityId: 1, albumIds: [] })],
      });
      await applyLocalMutation({ type: "album.addEvent", input: { albumId: 2, logId: 5 } });

      expect((await store<{ eventLogIds: number[] }>("albums"))[0].eventLogIds).toEqual([5]);
      expect((await store<{ albumIds: number[] }>("logs"))[0].albumIds).toEqual([2]);
      expect((await listOutbox())[0]).toMatchObject({ type: "album.addEvent", payload: { albumId: 2, logId: 5 } });
    });

    it("album.removeEvent annihilates a still-pending album.addEvent for the pair", async () => {
      await seedLocalDb({
        albums: [makeAlbum({ id: 2, eventLogIds: [] })],
        logs: [makeLog({ id: 5, entityId: 1, albumIds: [] })],
      });
      await applyLocalMutation({ type: "album.addEvent", input: { albumId: 2, logId: 5 } });
      await applyLocalMutation({ type: "album.removeEvent", input: { albumId: 2, logId: 5 } });

      expect(await listOutbox()).toEqual([]);
      expect((await store<{ eventLogIds: number[] }>("albums"))[0].eventLogIds).toEqual([]);
    });

    it("album.addEvent on a temp album folds into its pending create", async () => {
      await seedLocalDb({ logs: [makeLog({ id: 5, entityId: 1, albumIds: [] })] });
      const album = await applyLocalMutation({
        type: "album.create",
        input: { title: "Trip", eventLogIds: [], people: [] },
      });
      await applyLocalMutation({ type: "album.addEvent", input: { albumId: album.id, logId: 5 } });

      const envs = await listOutbox();
      expect(envs).toHaveLength(1);
      expect(envs[0]).toMatchObject({ type: "album.create", payload: { eventLogIds: [5] } });
    });
  });

  describe("notes", () => {
    it("note.create mints a temp row + envelope", async () => {
      await seedLocalDb({ entities: [makePerson("Alice", { id: 4 })] });
      const row = await applyLocalMutation({
        type: "note.create",
        input: { entityId: 4, body: "remember this" },
      });
      expect((row as { id: number; entityId: number }).id).toBe(-1);
      expect((await store<{ body: string }>("entityNotes"))[0].body).toBe("remember this");
      expect((await listOutbox())[0]).toMatchObject({ type: "note.create", tempId: -1, payload: { entityId: 4 } });
    });

    it("note.delete soft-deletes a real note and hides it from snapshots", async () => {
      await seedLocalDb({
        entities: [makePerson("Alice", { id: 4 })],
        notes: [makeNote({ id: 8, entityId: 4, version: 1 })],
      });
      await applyLocalMutation({ type: "note.delete", input: { noteId: 8 } });
      expect((await store<{ _localDeleted?: boolean }>("entityNotes"))[0]._localDeleted).toBe(true);
      expect((await loadSnapshot()).notes).toEqual([]);
      expect((await pendingOutbox())[0]).toMatchObject({ type: "note.delete", payload: { noteId: 8 } });
    });
  });
});
