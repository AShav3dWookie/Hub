import { describe, it, expect, beforeEach } from "vitest";
import { getDB, getMeta, setMeta, closeDB, META_SYNC_CURSOR, SYNC_STORES } from "./db.js";
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
});
