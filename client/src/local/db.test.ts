import { describe, it, expect, beforeEach } from "vitest";
import { openDB } from "idb";
import {
  getDB,
  getMeta,
  setMeta,
  closeDB,
  DB_NAME,
  META_SYNC_CURSOR,
  META_TEMP_ID_SEQ,
  SYNC_STORES,
} from "./db.js";
import { makeEntity, makeLog, resetFixtureCounters } from "../test/seedLocalDb.js";

describe("local db", () => {
  beforeEach(() => resetFixtureCounters());

  it("creates every sync store plus meta", async () => {
    const db = await getDB();
    for (const store of SYNC_STORES) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
    expect(db.objectStoreNames.contains("meta")).toBe(true);
  });

  it("round-trips rows by id and via indexes", async () => {
    const db = await getDB();
    const movie = makeEntity({ title: "Heat" });
    const log1 = makeLog({ entityId: movie.id, date: "2024-03-01" });
    const log2 = makeLog({ entityId: movie.id, date: "2024-05-01" });
    await db.put("entities", movie);
    await db.put("logs", log1);
    await db.put("logs", log2);

    expect(await db.get("entities", movie.id)).toMatchObject({ title: "Heat" });
    expect((await db.getAllFromIndex("logs", "by-entity", movie.id)).map((l) => l.id).sort()).toEqual(
      [log1.id, log2.id],
    );
    expect((await db.getAllFromIndex("logs", "by-date", "2024-05-01")).map((l) => l.id)).toEqual([
      log2.id,
    ]);
  });

  it("meta get/set round-trips arbitrary values", async () => {
    await setMeta(META_SYNC_CURSOR, "42");
    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("42");
    expect(await getMeta("never-set")).toBeUndefined();
  });

  it("closeDB lets a fresh handle reopen the same data", async () => {
    await (await getDB()).put("entities", makeEntity({ title: "A" }));
    await closeDB();
    const db2 = await getDB();
    expect(await db2.count("entities")).toBe(1);
  });

  describe("upgrading a replica from the build before lists", () => {
    /**
     * Build the version-2 database exactly as the previous release left it on a phone: the
     * five sync stores, meta and the outbox, with a cursor, a row, a counter and a queued write.
     */
    async function seedPreviousRelease() {
      const old = await openDB(DB_NAME, 2, {
        upgrade(db) {
          const entities = db.createObjectStore("entities", { keyPath: "id" });
          entities.createIndex("by-category", "category");
          entities.createIndex("by-rowSeq", "rowSeq");
          const logs = db.createObjectStore("logs", { keyPath: "id" });
          logs.createIndex("by-entity", "entityId");
          logs.createIndex("by-date", "date");
          logs.createIndex("by-rowSeq", "rowSeq");
          const photos = db.createObjectStore("photos", { keyPath: "id" });
          photos.createIndex("by-log", "logId");
          photos.createIndex("by-album", "albumId");
          photos.createIndex("by-rowSeq", "rowSeq");
          db.createObjectStore("albums", { keyPath: "id" }).createIndex("by-rowSeq", "rowSeq");
          const notes = db.createObjectStore("entityNotes", { keyPath: "id" });
          notes.createIndex("by-entity", "entityId");
          notes.createIndex("by-rowSeq", "rowSeq");
          db.createObjectStore("meta", { keyPath: "key" });
          db.createObjectStore("outbox", { keyPath: "mutationId" }).createIndex("by-seq", "seq");
        },
      });
      await old.put("entities", makeEntity({ id: 7, title: "Heat" }));
      await old.put("meta", { key: META_SYNC_CURSOR, value: "812" });
      await old.put("meta", { key: META_TEMP_ID_SEQ, value: -4 });
      await old.put("outbox", { mutationId: "queued", seq: 1, status: "pending" });
      old.close();
    }

    it("adds the list stores and keeps everything already there", async () => {
      await seedPreviousRelease();
      const db = await getDB();

      expect(db.version).toBe(3);
      expect([...db.transaction("lists").store.indexNames]).toEqual(["by-kind", "by-rowSeq"]);
      expect([...db.transaction("listItems").store.indexNames]).toEqual(["by-list", "by-rowSeq"]);
      expect(await db.get("entities", 7)).toMatchObject({ title: "Heat" });
      expect(await db.get("outbox", "queued")).toBeDefined();
      expect(await getMeta(META_TEMP_ID_SEQ)).toBe(-4);
    });

    it("forgets the sync cursor once, so the next sync re-pulls the list rows it skipped", async () => {
      await seedPreviousRelease();
      await getDB();
      expect(await getMeta(META_SYNC_CURSOR)).toBeUndefined();

      // Only the upgrade clears it: a cursor saved afterwards survives reopening.
      await setMeta(META_SYNC_CURSOR, "900");
      await closeDB();
      await getDB();
      expect(await getMeta(META_SYNC_CURSOR)).toBe("900");
    });
  });
});
