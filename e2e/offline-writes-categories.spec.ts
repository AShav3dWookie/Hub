import { test, expect } from "@playwright/test";
import { readStore, syncFromSettings } from "./helpers/app";
import { addLog, assertReplicaClean, bootstrap, feedWhere } from "./helpers/writes";

/**
 * Every loggable category can be created offline, shows up immediately in the offline replica,
 * and lands on the server intact once synced — with that category's specific fields
 * (rating / release year / author / auto-delete / year-vs-day date).
 */

test.beforeEach(async ({ page }) => bootstrap(page));

test("offline movie log with a rating + release year persists", async ({ page, context }) => {
  const tag = `cat-movie-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "movie", { title: tag, rating: 4, releaseYear: "1999", notes: "on the couch" });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === tag));
  const ent = feed.entities.find((e) => e.title === tag);
  expect(ent).toMatchObject({ category: "movie", releaseYear: 1999 });
  expect(ent!.id).toBeGreaterThan(0);
  expect(feed.logs.find((l) => l.entityId === ent!.id)).toMatchObject({ rating: 4, notes: "on the couch" });
  await assertReplicaClean(page);
});

test("offline eating-out log with a companion persists (people + day date)", async ({ page, context }) => {
  const tag = `cat-eat-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "eating_out", { title: tag, rating: 5, date: "2026-03-14", person: `Dinner Guest ${tag}` });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === tag));
  const place = feed.entities.find((e) => e.title === tag);
  const guest = feed.entities.find((e) => e.title === `Dinner Guest ${tag}`);
  expect(place).toMatchObject({ category: "eating_out" });
  expect(guest).toMatchObject({ category: "person" });
  const log = feed.logs.find((l) => l.entityId === place!.id);
  expect(log).toMatchObject({ rating: 5, date: "2026-03-14" });
  expect(log!.peopleIds).toEqual([guest!.id]);
  await assertReplicaClean(page);
});

test("offline book log with an author persists (year granularity)", async ({ page, context }) => {
  const tag = `cat-book-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "book", { title: tag, author: `Author ${tag}`, year: "2021", rating: 3 });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === tag));
  const ent = feed.entities.find((e) => e.title === tag);
  expect(ent).toMatchObject({ category: "book", author: `Author ${tag}` });
  expect(feed.logs.find((l) => l.entityId === ent!.id)).toMatchObject({ rating: 3, date: "2021-01-01" });
  await assertReplicaClean(page);
});

test("offline tv log persists (year granularity, no people)", async ({ page, context }) => {
  const tag = `cat-tv-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "tv", { title: tag, year: "2024", rating: 5, notes: "binged it" });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === tag));
  const ent = feed.entities.find((e) => e.title === tag);
  expect(ent).toMatchObject({ category: "tv" });
  expect(feed.logs.find((l) => l.entityId === ent!.id)).toMatchObject({
    rating: 5,
    notes: "binged it",
    date: "2024-01-01",
  });
  await assertReplicaClean(page);
});

test("offline game log persists (release year + year granularity)", async ({ page, context }) => {
  const tag = `cat-game-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "game", { title: tag, releaseYear: "2017", year: "2025", rating: 4 });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === tag));
  const ent = feed.entities.find((e) => e.title === tag);
  expect(ent).toMatchObject({ category: "game", releaseYear: 2017 });
  expect(feed.logs.find((l) => l.entityId === ent!.id)).toMatchObject({ rating: 4, date: "2025-01-01" });
  await assertReplicaClean(page);
});

test("offline appointment log persists with autoDelete", async ({ page, context }) => {
  const tag = `cat-appt-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "appointment", { title: tag, date: "2027-01-15" }); // checkbox defaults to checked

  const queued = await readStore<{ type: string; payload: { autoDelete?: boolean } }>(
    page,
    "logger",
    "outbox",
  );
  expect(queued.find((e) => e.type === "log.create")?.payload.autoDelete).toBe(true);

  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === tag));
  const ent = feed.entities.find((e) => e.title === tag);
  expect(feed.logs.find((l) => l.entityId === ent!.id)).toMatchObject({
    autoDelete: true,
    date: "2027-01-15",
  });
  await assertReplicaClean(page);
});

test("offline hang-out log persists (people, no rating)", async ({ page, context }) => {
  const tag = `cat-hang-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "hang_out", { title: tag, date: "2026-08-08", person: `Mate ${tag}`, notes: "good times" });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === tag));
  const ent = feed.entities.find((e) => e.title === tag);
  const mate = feed.entities.find((e) => e.title === `Mate ${tag}`);
  const log = feed.logs.find((l) => l.entityId === ent!.id);
  expect(ent).toMatchObject({ category: "hang_out" });
  expect(log).toMatchObject({ rating: null, notes: "good times", date: "2026-08-08" });
  expect(log!.peopleIds).toEqual([mate!.id]);
  await assertReplicaClean(page);
});

test("an offline-created log is searchable before it has synced", async ({ page, context }) => {
  const tag = `cat-search-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "movie", { title: tag });

  await page.goto("/search");
  await page.getByRole("textbox").first().fill(tag);
  await expect(page.getByText(tag).first()).toBeVisible();

  await context.setOffline(false);
  await syncFromSettings(page);
  await assertReplicaClean(page);
});
