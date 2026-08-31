import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { SyncChangesResponse } from "@logger/shared";
import { pullChanges, SyncError } from "./pull.js";
import {
  getDB,
  getMeta,
  setMeta,
  META_SYNC_CURSOR,
  META_LAST_SYNC_AT,
  META_LAST_SYNC_ERROR,
} from "../local/db.js";
import { makeEntity, makeLog, resetFixtureCounters } from "../test/seedLocalDb.js";

interface PageOverrides {
  changes?: Partial<SyncChangesResponse["changes"]>;
  deletions?: SyncChangesResponse["deletions"];
  nextCursor?: string;
  hasMore?: boolean;
}

function page(over: PageOverrides = {}): SyncChangesResponse {
  return {
    changes: { entities: [], logs: [], photos: [], albums: [], entityNotes: [], ...over.changes },
    deletions: over.deletions ?? [],
    nextCursor: over.nextCursor ?? "0",
    hasMore: over.hasMore ?? false,
    serverTime: "2026-06-15T00:00:00.000Z",
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("pullChanges", () => {
  beforeEach(() => resetFixtureCounters());
  afterEach(() => vi.unstubAllGlobals());

  it("walks every page from the stored cursor and applies each", async () => {
    const e1 = makeEntity({ title: "Heat" });
    const l1 = makeLog({ entityId: e1.id });
    const e2 = makeEntity({ title: "Dune" });

    const responses = [
      page({ changes: { entities: [e1], logs: [l1] }, nextCursor: "2", hasMore: true }),
      page({ changes: { entities: [e2] }, nextCursor: "3", hasMore: false }),
    ];
    const fetchMock = vi.fn((url: string): Promise<unknown> => {
      expect(url).toContain("/api/sync/changes?since=");
      return Promise.resolve(ok(responses.shift()));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pullChanges();
    expect(result).toMatchObject({ pages: 2, cursor: "3" });

    const db = await getDB();
    expect(await db.count("entities")).toBe(2);
    expect(await db.count("logs")).toBe(1);
    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("3");
    expect(await getMeta<number>(META_LAST_SYNC_AT)).toBeTypeOf("number");
    expect(await getMeta(META_LAST_SYNC_ERROR)).toBeNull();

    // First request used the bootstrap cursor.
    expect(fetchMock.mock.calls[0][0]).toContain("since=0");
    expect(fetchMock.mock.calls[1][0]).toContain("since=2");
  });

  it("resumes from a previously stored cursor", async () => {
    await setMeta(META_SYNC_CURSOR, "41");
    const fetchMock = vi.fn((_url: string) => Promise.resolve(ok(page({ nextCursor: "41" }))));
    vi.stubGlobal("fetch", fetchMock);

    await pullChanges();
    expect(fetchMock.mock.calls[0][0]).toContain("since=41");
  });

  it("is single-flight — concurrent callers share one run", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(ok(page({ nextCursor: "1" })));
      }),
    );
    const [a, b] = await Promise.all([pullChanges(), pullChanges()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("a 401 is recorded as an auth error and leaves the replica intact", async () => {
    await setMeta(META_SYNC_CURSOR, "5");
    const db = await getDB();
    await db.put("entities", makeEntity({ title: "Keep me" }));

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: "nope" }) })),
    );

    await expect(pullChanges()).rejects.toMatchObject({ kind: "auth" });
    await expect(pullChanges()).rejects.toBeInstanceOf(SyncError);

    expect(await getMeta(META_LAST_SYNC_ERROR)).toBe("auth");
    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("5");
    expect(await db.count("entities")).toBe(1);
  });

  it("a network failure is classified and rethrown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(pullChanges()).rejects.toMatchObject({ kind: "network" });
    expect(await getMeta(META_LAST_SYNC_ERROR)).toBe("network");
  });
});
