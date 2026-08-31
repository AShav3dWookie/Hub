import { test, expect } from "@playwright/test";
import type { SyncChangesResponse } from "@logger/shared";

/**
 * The delta-sync change-feed against the real built server + migrations + seed data. The
 * client doesn't consume this yet (that's a later branch) — this just proves the endpoint
 * is wired and shaped correctly end to end.
 */
test.describe("sync change-feed", () => {
  test("bootstraps the seeded dataset from since=0", async ({ request }) => {
    const res = await request.get("/api/sync/changes?since=0");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as SyncChangesResponse;

    expect(body.changes.entities.length).toBeGreaterThan(0);
    expect(body.changes.logs.length).toBeGreaterThan(0);
    expect(body.changes.entityNotes.length).toBeGreaterThan(0); // seed has important-date notes
    expect(body.deletions).toEqual([]);
    expect(typeof body.nextCursor).toBe("string");
    expect(Number(body.nextCursor)).toBeGreaterThan(0);

    // Every delivered row carries sync metadata; rowSeqs are distinct.
    const allSeqs = [
      ...body.changes.entities,
      ...body.changes.logs,
      ...body.changes.photos,
      ...body.changes.albums,
      ...body.changes.entityNotes,
    ].map((r) => r.rowSeq);
    expect(new Set(allSeqs).size).toBe(allSeqs.length);
    expect(Math.min(...allSeqs)).toBeGreaterThan(0);
  });

  test("nothing new once caught up", async ({ request }) => {
    const first = (await (await request.get("/api/sync/changes?since=0")).json()) as SyncChangesResponse;
    // Walk to the end in case the seed exceeds one page.
    let cursor = first.nextCursor;
    let body = first;
    while (body.hasMore) {
      body = (await (
        await request.get(`/api/sync/changes?since=${cursor}`)
      ).json()) as SyncChangesResponse;
      cursor = body.nextCursor;
    }

    const caughtUp = (await (
      await request.get(`/api/sync/changes?since=${cursor}`)
    ).json()) as SyncChangesResponse;
    expect(caughtUp.changes.entities).toEqual([]);
    expect(caughtUp.changes.logs).toEqual([]);
    expect(caughtUp.hasMore).toBe(false);
    expect(caughtUp.nextCursor).toBe(cursor);
  });
});
