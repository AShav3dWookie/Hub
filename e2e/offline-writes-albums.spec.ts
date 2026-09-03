import { test, expect, type Page } from "@playwright/test";
import { readStore, syncFromSettings } from "./helpers/app";
import { addAlbum, addLog, assertReplicaClean, bootstrap, feedWhere } from "./helpers/writes";

/**
 * Album link operations (add/remove event, add/remove person, edit, delete) all queue offline
 * and persist to the server on sync — including the tricky cases where one side of the link is
 * a still-temp row.
 */

test.beforeEach(async ({ page }) => bootstrap(page));

/** Open an album from the Albums list by title (gets its real id, not a temp URL). */
async function openAlbum(page: Page, title: string) {
  await page.goto("/albums");
  await page.getByRole("link", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("offline: create an album linking a seeded log, then sync", async ({ page, context }) => {
  const tag = `alb-link-${Date.now().toString(36)}`;
  // A synced log to link.
  await addLog(page, "movie", { title: `Event ${tag}` });
  await syncFromSettings(page);
  const seeded = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === `Event ${tag}`));
  const logId = seeded.logs.find((l) => l.entityId === seeded.entities.find((e) => e.title === `Event ${tag}`)?.id)?.id;
  expect(logId).toBeGreaterThan(0);

  await context.setOffline(true);
  await page.goto("/add/album");
  await page.getByLabel("Title").fill(`Album ${tag}`);
  await page.getByPlaceholder(/find an event to add/i).fill(`Event ${tag}`);
  await page.getByRole("button", { name: new RegExp(`Event ${tag}`) }).first().click();
  await page.getByRole("button", { name: /create album/i }).click();
  await expect(page).toHaveURL(/\/album\/-?\d+/);
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.albums.some((a) => a.title === `Album ${tag}`));
  const album = feed.albums.find((a) => a.title === `Album ${tag}`);
  expect(album!.id).toBeGreaterThan(0);
  expect(album!.eventLogIds).toEqual([logId]);
  expect(feed.logs.find((l) => l.id === logId)!.albumIds).toContain(album!.id);
  await assertReplicaClean(page);
});

test("offline: add then remove an event on a synced album — nets to no link", async ({ page, context }) => {
  const tag = `alb-toggle-${Date.now().toString(36)}`;
  await addLog(page, "movie", { title: `Toggle ${tag}` });
  await addAlbum(page, `Toggle Album ${tag}`);
  await syncFromSettings(page);

  await context.setOffline(true);
  await openAlbum(page, `Toggle Album ${tag}`);
  await page.getByPlaceholder(/find an event to add/i).fill(`Toggle ${tag}`);
  await page.getByRole("button", { name: new RegExp(`Toggle ${tag}`) }).first().click();
  await expect(page.getByRole("button", { name: new RegExp(`Remove Toggle ${tag} from album`, "i") })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Remove Toggle ${tag} from album`, "i") }).click();
  await context.setOffline(false);
  await syncFromSettings(page);

  await assertReplicaClean(page);
  const feed = await feedWhere(page.request, (f) => f.albums.some((a) => a.title === `Toggle Album ${tag}`));
  const album = feed.albums.find((a) => a.title === `Toggle Album ${tag}`);
  expect(album!.eventLogIds).toEqual([]);
  await assertReplicaClean(page);
});

test("offline: add a new person to a synced album, then sync", async ({ page, context }) => {
  const tag = `alb-person-${Date.now().toString(36)}`;
  await addAlbum(page, `People Album ${tag}`);
  await syncFromSettings(page);

  await context.setOffline(true);
  await openAlbum(page, `People Album ${tag}`);
  const input = page.getByPlaceholder(/add a person/i);
  await input.fill(`Album Pal ${tag}`);
  await input.press("Enter");
  await page.getByRole("button", { name: /add to album/i }).click();
  await expect(page.getByText(`Album Pal ${tag}`)).toBeVisible();
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === `Album Pal ${tag}`));
  const album = feed.albums.find((a) => a.title === `People Album ${tag}`);
  const pal = feed.entities.find((e) => e.title === `Album Pal ${tag}`);
  expect(pal).toMatchObject({ category: "person" });
  expect(album!.personIds).toEqual([pal!.id]);
  await assertReplicaClean(page);
});

test("offline: rename a synced album twice, then sync — final name once", async ({ page, context }) => {
  const tag = `alb-rename-${Date.now().toString(36)}`;
  await addAlbum(page, `Rename ${tag} v0`);
  await syncFromSettings(page);

  await context.setOffline(true);
  await openAlbum(page, `Rename ${tag} v0`);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByRole("textbox").first().fill(`Rename ${tag} v1`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: `Rename ${tag} v1` })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByRole("textbox").first().fill(`Rename ${tag} v2`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: `Rename ${tag} v2` })).toBeVisible();
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.albums.some((a) => a.title === `Rename ${tag} v2`));
  expect(feed.albums.filter((a) => /Rename .* v[012]$/.test(a.title ?? ""))).toHaveLength(1);
  expect(feed.albums.some((a) => a.title === `Rename ${tag} v2`)).toBe(true);
  await assertReplicaClean(page);
});

test("offline: build a whole album graph (new album + new log + link + new person)", async ({ page, context }) => {
  const tag = `alb-graph-${Date.now().toString(36)}`;

  await context.setOffline(true);
  await addLog(page, "movie", { title: `Graph Film ${tag}` });
  await page.goto("/add/album");
  await page.getByLabel("Title").fill(`Graph Album ${tag}`);
  await page.getByPlaceholder(/find an event to add/i).fill(`Graph Film ${tag}`);
  await page.getByRole("button", { name: new RegExp(`Graph Film ${tag}`) }).first().click();
  await page.getByRole("button", { name: /create album/i }).click();
  await expect(page).toHaveURL(/\/album\/-?\d+/);

  const input = page.getByPlaceholder(/add a person/i);
  await input.fill(`Graph Person ${tag}`);
  await input.press("Enter");
  await page.getByRole("button", { name: /add to album/i }).click();

  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === `Graph Person ${tag}`));
  const album = feed.albums.find((a) => a.title === `Graph Album ${tag}`);
  const film = feed.entities.find((e) => e.title === `Graph Film ${tag}`);
  const person = feed.entities.find((e) => e.title === `Graph Person ${tag}`);
  const log = feed.logs.find((l) => l.entityId === film!.id);
  expect([album, film, person, log].every((x) => (x!.id ?? 1) > 0)).toBe(true);
  expect(album!.eventLogIds).toEqual([log!.id]);
  expect(album!.personIds).toEqual([person!.id]);
  expect(log!.albumIds).toEqual([album!.id]);
  await assertReplicaClean(page);
});

test("offline: delete a synced album — tombstone, gone from the feed", async ({ page, context }) => {
  const tag = `alb-del-${Date.now().toString(36)}`;
  await addAlbum(page, `Delete Album ${tag}`);
  await syncFromSettings(page);
  const before = await feedWhere(page.request, (f) => f.albums.some((a) => a.title === `Delete Album ${tag}`));
  const albumId = before.albums.find((a) => a.title === `Delete Album ${tag}`)?.id;
  expect(albumId).toBeGreaterThan(0);

  await context.setOffline(true);
  await openAlbum(page, `Delete Album ${tag}`);
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText("Delete this album?")).toBeVisible();
  // The Edit/Delete row stays visible next to the confirm row → the confirm button is the last one.
  await page.getByRole("button", { name: /^Delete$/ }).last().click();
  await context.setOffline(false);
  await syncFromSettings(page);
  await page.reload();
  await syncFromSettings(page);

  const feed = await feedWhere(
    page.request,
    (f) => f.deletions.some((d) => d.entityType === "album" && d.id === albumId),
  );
  expect(feed.deletions.some((d) => d.entityType === "album" && d.id === albumId)).toBe(true);
  expect(feed.albums.some((a) => a.id === albumId)).toBe(false);
  expect((await readStore<{ id: number }>(page, "logger", "albums")).some((a) => a.id === albumId)).toBe(false);
});
