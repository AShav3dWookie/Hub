import { test, expect } from "@playwright/test";
import { readStore, serviceWorkerState, syncFromSettings } from "./helpers/app";
import { addAlbum, addLog, assertReplicaClean, bootstrap, feedWhere, openEntity } from "./helpers/writes";

/**
 * How offline writes show up across the app's screens (search / calendar / albums / home),
 * the Settings "Pending changes" panel, the temp-URL edge after an offline-created record
 * syncs, and the photo-control gating on unsynced records.
 */

test.beforeEach(async ({ page }) => bootstrap(page));

test("an offline-created log shows on the calendar for its date (offline)", async ({ page, context }) => {
  const tag = `ui-cal-${Date.now().toString(36)}`;
  const date = "2026-11-20";

  await context.setOffline(true);
  // The calendar surfaces the "event"-shaped categories (eating out / hang out / appointment).
  await addLog(page, "eating_out", { title: `Cal Meal ${tag}`, date });

  await page.goto(`/calendar?date=${date}`);
  await expect(page.getByText(`Cal Meal ${tag}`)).toBeVisible();

  await context.setOffline(false);
  await syncFromSettings(page);
  await assertReplicaClean(page);
});

test("an offline-created album shows in the Albums list (offline) and after sync", async ({
  page,
  context,
}) => {
  const tag = `ui-albums-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addAlbum(page, `List Album ${tag}`);

  await page.goto("/albums");
  await expect(page.getByText(`List Album ${tag}`)).toBeVisible();

  await context.setOffline(false);
  await syncFromSettings(page);
  await page.reload();
  await page.goto("/albums");
  await expect(page.getByText(`List Album ${tag}`)).toBeVisible();

  const feed = await feedWhere(page.request, (f) => f.albums.some((a) => a.title === `List Album ${tag}`));
  expect(feed.albums.find((a) => a.title === `List Album ${tag}`)!.id).toBeGreaterThan(0);
});

test("Settings shows a pending count that clears after syncing", async ({ page, context }) => {
  const tag = `ui-pending-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "movie", { title: `Pending ${tag}` });
  await addLog(page, "movie", { title: `Pending ${tag} 2` });

  await page.goto("/settings");
  await expect(page.getByText("Pending changes")).toBeVisible();
  await expect(page.getByText(/Waiting to sync/)).toBeVisible();
  await expect(page.getByRole("button", { name: /retry now/i })).toBeVisible();

  await context.setOffline(false);
  await syncFromSettings(page);
  await page.reload();
  await expect(page.getByText("Pending changes")).toHaveCount(0);
  await assertReplicaClean(page);
});

test("navigating to a stale temp album URL after it synced does not wedge the app", async ({
  page,
  context,
}) => {
  const tag = `ui-tempurl-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addAlbum(page, `TempURL ${tag}`);
  const tempUrl = new URL(page.url()).pathname; // /album/-N
  expect(tempUrl).toMatch(/\/album\/-\d+/);

  await context.setOffline(false);
  await syncFromSettings(page);

  // The temp id no longer exists; the app should render a graceful "not found", not crash.
  await page.goto(tempUrl);
  await expect(page.getByText(/not found/i)).toBeVisible();

  // And the real album is reachable from the list.
  await page.goto("/albums");
  await page.getByText(`TempURL ${tag}`).click();
  await expect(page.getByRole("heading", { name: `TempURL ${tag}` })).toBeVisible();
});

test("photo controls are hidden on an unsynced record and appear once it syncs", async ({
  page,
  context,
}) => {
  const tag = `ui-photo-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "movie", { title: `Photo Film ${tag}` });

  await openEntity(page, `Photo Film ${tag}`);
  await expect(page.getByText(/photos can be added once this entry has synced/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add photos" })).toHaveCount(0);

  await context.setOffline(false);
  await syncFromSettings(page);

  await openEntity(page, `Photo Film ${tag}`);
  await expect(page.getByRole("button", { name: "Add photos" })).toBeVisible();
  await assertReplicaClean(page);
});

test("a fresh browser sees an offline-created record after its owner syncs", async ({
  page,
  context,
  browser,
}) => {
  const tag = `ui-fresh-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "eating_out", { title: `Fresh Meal ${tag}`, date: "2026-05-05", person: `Fresh Diner ${tag}` });
  await context.setOffline(false);
  await syncFromSettings(page);

  const ctx2 = await browser.newContext();
  try {
    const p2 = await ctx2.newPage();
    await p2.goto(new URL(page.url()).origin + "/");
    await p2.getByRole("heading", { name: "What would you like to do?" }).waitFor();
    expect(await serviceWorkerState(p2)).toBe("activated");
    await expect
      .poll(
        () =>
          readStore<{ title: string }>(p2, "logger", "entities").then((r) =>
            r.some((e) => e.title === `Fresh Meal ${tag}`),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    const ents = await readStore<{ title: string; id: number }>(p2, "logger", "entities");
    expect(ents.find((e) => e.title === `Fresh Diner ${tag}`)!.id).toBeGreaterThan(0);
    expect(ents.every((e) => e.id > 0)).toBe(true);
  } finally {
    await ctx2.close();
  }
});
