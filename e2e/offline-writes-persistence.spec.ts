import { test, expect, type Page } from "@playwright/test";
import type { SyncChangesResponse } from "@logger/shared";
import { E2E_BASE_URL } from "../playwright.config";
import { gotoHome, outboxCount, readStore, serviceWorkerState, syncFromSettings } from "./helpers/app";

/**
 * Persistence guarantees for the writes tier: whatever the user does offline — one write, a
 * dozen writes, several offline/online cycles, a page reload in the middle — must still be
 * there afterwards. Nothing queued may be silently dropped, nothing synced may vanish, and a
 * deleted row must not come back on the next pull.
 *
 * Every test tags its data with a unique suffix and asserts against the real server
 * (`GET /api/sync/changes`) and the real IndexedDB replica.
 */

const SYNC_STORES = ["entities", "logs", "albums", "entityNotes"] as const;

interface FeedRow {
  id: number;
  title?: string;
  entityId?: number;
  notes?: string | null;
  eventLogIds?: number[];
}

/** Walk every page of the change-feed from scratch and flatten it. */
async function fullFeed(request: import("@playwright/test").APIRequestContext) {
  let cursor = "0";
  const entities: FeedRow[] = [];
  const logs: FeedRow[] = [];
  const albums: FeedRow[] = [];
  const notes: FeedRow[] = [];
  const deletions: SyncChangesResponse["deletions"] = [];
  for (;;) {
    const body = (await (
      await request.get(`/api/sync/changes?since=${cursor}`)
    ).json()) as SyncChangesResponse;
    entities.push(...(body.changes.entities as FeedRow[]));
    logs.push(...(body.changes.logs as FeedRow[]));
    albums.push(...(body.changes.albums as FeedRow[]));
    notes.push(...(body.changes.entityNotes as FeedRow[]));
    deletions.push(...body.deletions);
    if (!body.hasMore) break;
    cursor = body.nextCursor;
  }
  return { entities, logs, albums, notes, deletions };
}

async function assertReplicaClean(page: Page) {
  for (const store of SYNC_STORES) {
    const rows = await readStore<{ id: number; _localDirty?: boolean; _localDeleted?: boolean }>(
      page,
      "logger",
      store,
    );
    expect(rows.every((r) => r.id > 0), `${store}: a negative id survived`).toBe(true);
    expect(rows.every((r) => !r._localDirty), `${store}: a dirty row survived`).toBe(true);
    expect(rows.every((r) => !r._localDeleted), `${store}: a soft-deleted row survived`).toBe(true);
  }
}

async function addMovie(page: Page, title: string, opts: { person?: string; notes?: string } = {}) {
  await page.goto("/add/movie");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByLabel("Title").fill(title);
  if (opts.notes) {
    await page.locator("textarea").first().fill(opts.notes);
  }
  if (opts.person) {
    await page.getByPlaceholder(/Add a person/i).fill(opts.person);
    await page.getByPlaceholder(/Add a person/i).press("Enter");
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
}

async function openEntity(page: Page, title: string) {
  await page.goto("/search");
  await page.getByRole("textbox").first().fill(title);
  await page.getByText(title, { exact: false }).first().click();
  await expect(page).toHaveURL(/\/(entity|person)\/-?\d+/);
}

async function editFirstLogNotes(page: Page, entityTitle: string, notes: string) {
  await openEntity(page, entityTitle);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.locator("textarea").first().fill(notes);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(notes)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");
  await expect
    .poll(() => readStore(page, "logger", "logs").then((r) => r.length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  // Start each test from a drained queue.
  await expect.poll(() => outboxCount(page)).toBe(0);
});

test("queued offline writes survive a full page reload before syncing", async ({ page, context }) => {
  const tag = `reload-${Date.now().toString(36)}`;

  await context.setOffline(true);
  await addMovie(page, `Movie ${tag}`);
  await page.goto("/add/album");
  await page.getByLabel("Title").fill(`Album ${tag}`);
  await page.getByRole("button", { name: /create album/i }).click();
  await expect(page).toHaveURL(/\/album\/-?\d+/);

  const before = await outboxCount(page);
  expect(before).toBeGreaterThanOrEqual(3); // entity.create + log.create + album.create

  // Back to home (client-side), then a full reload — served by the SW shell. IndexedDB
  // persists across the reload; the queue must be intact.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();

  expect(await outboxCount(page)).toBe(before);
  const entities = await readStore<{ title: string; id: number }>(page, "logger", "entities");
  expect(entities.some((e) => e.title === `Movie ${tag}` && e.id < 0)).toBe(true);
  const albums = await readStore<{ title: string; id: number }>(page, "logger", "albums");
  expect(albums.some((a) => a.title === `Album ${tag}` && a.id < 0)).toBe(true);

  // …and they still push cleanly once back online.
  await context.setOffline(false);
  await syncFromSettings(page);
  const feed = await fullFeed(page.request);
  expect(feed.entities.find((e) => e.title === `Movie ${tag}`)?.id).toBeGreaterThan(0);
  expect(feed.albums.find((a) => a.title === `Album ${tag}`)?.id).toBeGreaterThan(0);
  await assertReplicaClean(page);
});

test("interleaved offline batches: sync, write more offline, sync again — both persist", async ({
  page,
  context,
}) => {
  const tag = `interleave-${Date.now().toString(36)}`;

  // Batch 1 offline → sync.
  await context.setOffline(true);
  await addMovie(page, `A ${tag}`, { notes: "first" });
  await context.setOffline(false);
  await syncFromSettings(page);

  const afterFirst = await fullFeed(page.request);
  const aId = afterFirst.entities.find((e) => e.title === `A ${tag}`)?.id;
  expect(aId).toBeGreaterThan(0);

  // Batch 2 offline: a new record + an edit to batch 1's log.
  await context.setOffline(true);
  await addMovie(page, `B ${tag}`);
  await editFirstLogNotes(page, `A ${tag}`, "edited in batch 2");

  // The edit must be queued as a log.update against A's *real* server id.
  const queued = await readStore<{ type: string; payload: { logId?: number; notes?: string } }>(
    page,
    "logger",
    "outbox",
  );
  const upd = queued.find((e) => e.type === "log.update");
  expect(upd, "a log.update was queued").toBeDefined();
  expect(upd?.payload.logId).toBeGreaterThan(0);
  expect(upd?.payload.notes).toBe("edited in batch 2");

  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await fullFeed(page.request);
  expect(feed.entities.find((e) => e.title === `A ${tag}`)?.id).toBe(aId); // no duplicate A
  expect(feed.entities.find((e) => e.title === `B ${tag}`)?.id).toBeGreaterThan(0);
  const aLog = feed.logs.find((l) => l.entityId === aId);
  expect(aLog?.notes).toBe("edited in batch 2");

  // Survives a reload + offline browse.
  await page.reload();
  await context.setOffline(true);
  await openEntity(page, `B ${tag}`);
  await expect(page.getByText(`B ${tag}`).first()).toBeVisible();
  await context.setOffline(false);
  await assertReplicaClean(page);
});

test("syncing twice does not duplicate or drop anything", async ({ page, context }) => {
  const tag = `twice-${Date.now().toString(36)}`;

  await context.setOffline(true);
  await addMovie(page, `Once ${tag}`, { person: `Friend ${tag}` });
  await context.setOffline(false);

  await syncFromSettings(page);
  await syncFromSettings(page); // second pass — outbox already empty, must be a no-op
  await page.reload();
  await syncFromSettings(page); // and again after a reload

  const feed = await fullFeed(page.request);
  expect(feed.entities.filter((e) => e.title === `Once ${tag}`)).toHaveLength(1);
  expect(feed.entities.filter((e) => e.title === `Friend ${tag}`)).toHaveLength(1);
  const movieId = feed.entities.find((e) => e.title === `Once ${tag}`)?.id;
  expect(feed.logs.filter((l) => l.entityId === movieId)).toHaveLength(1);
  await assertReplicaClean(page);
});

test("an offline delete persists and is not resurrected by later pulls", async ({ page, context }) => {
  const tag = `del-${Date.now().toString(36)}`;

  // Create online + let it sync so it has a real server id.
  await addMovie(page, `Doomed ${tag}`);
  await syncFromSettings(page);
  const created = await fullFeed(page.request);
  const entId = created.entities.find((e) => e.title === `Doomed ${tag}`)?.id;
  const logId = created.logs.find((l) => l.entityId === entId)?.id;
  expect(logId).toBeGreaterThan(0);

  // Delete it offline.
  await context.setOffline(true);
  await openEntity(page, `Doomed ${tag}`);
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await expect
    .poll(() =>
      readStore<{ _localDeleted?: boolean; id: number }>(page, "logger", "logs").then((rows) =>
        rows.some((r) => r.id === logId && r._localDeleted),
      ),
    )
    .toBe(true);
  await context.setOffline(false);

  await syncFromSettings(page);
  await syncFromSettings(page); // a second pull must not bring it back
  await page.reload();
  await expect.poll(() => outboxCount(page)).toBe(0);

  const feed = await fullFeed(page.request);
  expect(feed.deletions.some((d) => d.entityType === "log" && d.id === logId)).toBe(true);
  expect(feed.logs.some((l) => l.id === logId)).toBe(false);
  const replicaLogs = await readStore<{ id: number }>(page, "logger", "logs");
  expect(replicaLogs.some((l) => l.id === logId)).toBe(false);
});

test("a freshly-installed browser converges to the full server state", async ({
  page,
  context,
  browser,
}) => {
  const tag = `fresh-${Date.now().toString(36)}`;

  await context.setOffline(true);
  await addMovie(page, `Shared ${tag}`, { person: `Guest ${tag}` });
  await context.setOffline(false);
  await syncFromSettings(page);

  // A brand-new context = a new device with no SW, no IndexedDB, no install.
  const ctx2 = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    const p2 = await ctx2.newPage();
    await gotoHome(p2);
    expect(await serviceWorkerState(p2)).toBe("activated");
    await expect
      .poll(() => readStore(p2, "logger", "entities").then((r) => r.length), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        readStore<{ title: string }>(p2, "logger", "entities").then((r) =>
          r.some((e) => e.title === `Shared ${tag}`),
        ),
      { timeout: 15_000 })
      .toBe(true);

    const entities = await readStore<{ title: string; id: number }>(p2, "logger", "entities");
    expect(entities.some((e) => e.title === `Shared ${tag}` && e.id > 0)).toBe(true);
    expect(entities.some((e) => e.title === `Guest ${tag}` && e.id > 0)).toBe(true);
    expect(entities.every((e) => e.id > 0)).toBe(true);

    // It can browse the shared record offline immediately.
    await ctx2.setOffline(true);
    await p2.goto("/search");
    await p2.getByRole("textbox").first().fill(`Shared ${tag}`);
    await expect(p2.getByText(`Shared ${tag}`).first()).toBeVisible();
  } finally {
    await ctx2.close();
  }
});

test("last-write-wins: an offline edit still wins over an already-changed server row", async ({
  page,
  context,
  request,
}) => {
  const tag = `lww-${Date.now().toString(36)}`;
  const entityTitle = "The Grand Budapest Hotel"; // seeded, single log, untouched by other specs

  // Real log id from the replica.
  const entities = await readStore<{ id: number; title: string }>(page, "logger", "entities");
  const entId = entities.find((e) => e.title === entityTitle)?.id;
  const logs = await readStore<{ id: number; entityId: number }>(page, "logger", "logs");
  const logId = logs.find((l) => l.entityId === entId)?.id;
  expect(logId).toBeGreaterThan(0);

  // Another device changes the row on the server first — the client is still online but hasn't
  // pulled it, so its queued edit will carry a stale baseVersion.
  const putRes = await request.put(`/api/logs/${logId}`, {
    data: { rating: 4, date: "2026-06-01", notes: `server wins ${tag}`, people: [{ name: "Carol" }] },
  });
  expect(putRes.ok()).toBeTruthy();

  // Client goes offline (so it can't pull the server's version), then edits the same row.
  await context.setOffline(true);
  await editFirstLogNotes(page, entityTitle, `client wins ${tag}`);

  const queued = await readStore<{ type: string; payload: { logId?: number } }>(
    page,
    "logger",
    "outbox",
  );
  expect(queued.find((e) => e.type === "log.update")?.payload.logId).toBe(logId);

  // Reconnect and sync — the stale-baseVersion update is a conflict, but LWW still applies it.
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await fullFeed(request);
  expect(feed.logs.find((l) => l.id === logId)?.notes).toBe(`client wins ${tag}`);

  // A conflict is applied, not rejected — nothing is dead-lettered.
  expect(await readStore(page, "logger", "outbox")).toHaveLength(0);
  await assertReplicaClean(page);
});
