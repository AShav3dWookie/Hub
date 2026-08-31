import { describe, it, expect, beforeEach } from "vitest";
import type { SyncChangesResponse } from "@logger/shared";
import { applyChanges, countChanges } from "./apply.js";
import { getDB, getMeta, META_SYNC_CURSOR } from "../local/db.js";
import {
  makeAlbum,
  makeEntity,
  makeLog,
  makeNote,
  makePhoto,
  resetFixtureCounters,
} from "../test/seedLocalDb.js";

interface FeedOverrides {
  changes?: Partial<SyncChangesResponse["changes"]>;
  deletions?: SyncChangesResponse["deletions"];
  nextCursor?: string;
  hasMore?: boolean;
}

function feed(over: FeedOverrides = {}): SyncChangesResponse {
  return {
    changes: {
      entities: [],
      logs: [],
      photos: [],
      albums: [],
      entityNotes: [],
      ...over.changes,
    },
    deletions: over.deletions ?? [],
    nextCursor: over.nextCursor ?? "0",
    hasMore: over.hasMore ?? false,
    serverTime: "2026-06-15T00:00:00.000Z",
  };
}

describe("applyChanges", () => {
  beforeEach(() => resetFixtureCounters());

  it("upserts every table and advances the cursor in one shot", async () => {
    const entity = makeEntity({ title: "Heat" });
    const log = makeLog({ entityId: entity.id });
    const photo = makePhoto({ logId: log.id });
    const album = makeAlbum();
    const note = makeNote({ entityId: entity.id });

    await applyChanges(
      feed({
        changes: { entities: [entity], logs: [log], photos: [photo], albums: [album], entityNotes: [note] },
        nextCursor: "7",
      }),
    );

    const db = await getDB();
    expect(await db.count("entities")).toBe(1);
    expect(await db.count("logs")).toBe(1);
    expect(await db.count("photos")).toBe(1);
    expect(await db.count("albums")).toBe(1);
    expect(await db.count("entityNotes")).toBe(1);
    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("7");
  });

  it("updates an existing row rather than duplicating it", async () => {
    const entity = makeEntity({ title: "Heat" });
    await applyChanges(feed({ changes: { entities: [entity] }, nextCursor: "1" }));
    await applyChanges(
      feed({
        changes: { entities: [{ ...entity, title: "Heat (Director's Cut)", version: 2, rowSeq: 9 }] },
        nextCursor: "9",
      }),
    );

    const db = await getDB();
    expect(await db.count("entities")).toBe(1);
    expect((await db.get("entities", entity.id))?.title).toBe("Heat (Director's Cut)");
  });

  it("deletes tombstoned rows, mapping entityType → store", async () => {
    const entity = makeEntity({ title: "Heat" });
    const log = makeLog({ entityId: entity.id });
    const photo = makePhoto({ logId: log.id });
    await applyChanges(
      feed({ changes: { entities: [entity], logs: [log], photos: [photo] }, nextCursor: "3" }),
    );

    await applyChanges(
      feed({
        deletions: [
          { entityType: "log", id: log.id, rowSeq: 10, deletedAt: "2026-06-15T00:00:00.000Z" },
          { entityType: "log_photo", id: photo.id, rowSeq: 11, deletedAt: "2026-06-15T00:00:00.000Z" },
        ],
        nextCursor: "11",
      }),
    );

    const db = await getDB();
    expect(await db.count("logs")).toBe(0);
    expect(await db.count("photos")).toBe(0);
    expect(await db.count("entities")).toBe(1);
    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("11");
  });

  it("countChanges sums upserts and deletions", () => {
    resetFixtureCounters();
    expect(
      countChanges(
        feed({
          changes: { entities: [makeEntity()], logs: [makeLog(), makeLog()] },
          deletions: [{ entityType: "album", id: 1, rowSeq: 1, deletedAt: "x" }],
        }),
      ),
    ).toBe(4);
  });
});
