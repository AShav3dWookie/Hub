import { test, expect } from "@playwright/test";
import type { SyncChangesResponse } from "@logger/shared";
import { gotoHome, readStore, serviceWorkerState } from "./helpers/app";

/**
 * The writes tier end to end: with the network down, create / edit / delete across the
 * loggable types, then reconnect and let the sync push the queue. The server must end up
 * with every change (real positive ids) and the local replica must hold no temp ids and no
 * un-pushed rows.
 */

const SYNC_STORES = ["entities", "logs", "photos", "albums", "entityNotes"] as const;

async function replicaHasNoTempState(page: import("@playwright/test").Page) {
  for (const store of SYNC_STORES) {
    const rows = await readStore<{ id: number; _localDirty?: boolean; _localDeleted?: boolean }>(
      page,
      "logger",
      store,
    );
    expect(rows.every((r) => r.id > 0), `${store} has a negative id`).toBe(true);
    expect(rows.every((r) => !r._localDirty), `${store} still has a dirty row`).toBe(true);
    expect(rows.every((r) => !r._localDeleted), `${store} still has a soft-deleted row`).toBe(true);
  }
}

test("offline create / edit / delete, then reconnect and sync", async ({ page, context, request }) => {
  const tag = Date.now().toString(36);
  const movieTitle = `Offline Movie ${tag}`;
  const albumTitle = `Offline Album ${tag}`;
  const personName = `Offline Person ${tag}`;

  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");
  await expect
    .poll(async () => (await readStore(page, "logger", "logs")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  await context.setOffline(true);

  // --- create: a movie log against a brand-new title + a new {name} person tag ---
  await page.goto("/add/movie");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByLabel("Title").fill(movieTitle);
  await page.getByPlaceholder(/Add a person/i).fill(personName);
  await page.getByPlaceholder(/Add a person/i).press("Enter");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();

  // --- create: an album ---
  await page.goto("/add/album");
  await page.getByLabel("Title").fill(albumTitle);
  await page.getByRole("button", { name: /create album/i }).click();
  await expect(page).toHaveURL(/\/album\/-?\d+/);

  // --- edit: an existing log's notes ---
  await page.goto("/search");
  await page.getByRole("textbox").first().fill("Interstellar");
  await page.getByText("Interstellar").first().click();
  await expect(page).toHaveURL(/\/entity\/\d+/);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.locator("textarea").first().fill(`edited offline ${tag}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`edited offline ${tag}`)).toBeVisible();

  // --- delete: an existing log ---
  await page.goto("/search");
  await page.getByRole("textbox").first().fill("Dune");
  await page.getByText("Dune: Part Two").first().click();
  await expect(page).toHaveURL(/\/entity\/\d+/);
  const logsBefore = (await readStore<{ _localDeleted?: boolean }>(page, "logger", "logs")).filter(
    (l) => !l._localDeleted,
  ).length;
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await expect
    .poll(async () =>
      (await readStore<{ _localDeleted?: boolean }>(page, "logger", "logs")).filter(
        (l) => l._localDeleted,
      ).length,
    )
    .toBeGreaterThan(0);
  expect(logsBefore).toBeGreaterThan(0);

  // The queue holds all five envelopes and the replica has temp rows.
  await expect
    .poll(async () => (await readStore(page, "logger", "outbox")).length)
    .toBeGreaterThanOrEqual(5);
  const negativeIds = (await readStore<{ id: number }>(page, "logger", "entities")).some(
    (r) => r.id < 0,
  );
  expect(negativeIds).toBe(true);

  // --- reconnect + sync ---
  await context.setOffline(false);
  await page.goto("/settings");
  await page.getByRole("button", { name: /sync now/i }).click();
  await expect
    .poll(async () => (await readStore(page, "logger", "outbox")).length, { timeout: 15_000 })
    .toBe(0);

  // Server has every change with real ids.
  const feed = (await (await request.get("/api/sync/changes?since=0")).json()) as SyncChangesResponse;
  // Walk any extra pages.
  let cursor = feed.nextCursor;
  const entities = [...feed.changes.entities];
  const albums = [...feed.changes.albums];
  let body = feed;
  while (body.hasMore) {
    body = (await (await request.get(`/api/sync/changes?since=${cursor}`)).json()) as SyncChangesResponse;
    entities.push(...body.changes.entities);
    albums.push(...body.changes.albums);
    cursor = body.nextCursor;
  }

  const movie = entities.find((e) => e.title === movieTitle);
  const person = entities.find((e) => e.title === personName);
  const album = albums.find((a) => a.title === albumTitle);
  expect(movie?.id).toBeGreaterThan(0);
  expect(person?.id).toBeGreaterThan(0);
  expect(album?.id).toBeGreaterThan(0);

  await replicaHasNoTempState(page);
});
