import { test, expect } from "@playwright/test";
import { readStore, syncFromSettings, outboxCount } from "./helpers/app";
import { addLog, assertReplicaClean, bootstrap, feedWhere, openEntity } from "./helpers/writes";

/**
 * Dependency chains and multi-write sessions: a new person referenced by several new logs, the
 * same new title used twice, edit-then-delete, create-then-delete, and writes spread across
 * offline/online flaps and a mid-session reload — all must land intact, deduped, and once.
 */

test.beforeEach(async ({ page }) => bootstrap(page));

test("one new person tagged on two new logs → a single person, both logs reference it", async ({
  page,
  context,
}) => {
  const tag = `graph-shared-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "movie", { title: `Film One ${tag}`, person: `Shared Pal ${tag}` });
  await addLog(page, "eating_out", { title: `Meal One ${tag}`, date: "2026-04-04", person: `Shared Pal ${tag}` });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === `Shared Pal ${tag}`));
  const pals = feed.entities.filter((e) => e.title === `Shared Pal ${tag}`);
  expect(pals).toHaveLength(1);
  const palId = pals[0].id;
  const film = feed.entities.find((e) => e.title === `Film One ${tag}`);
  const meal = feed.entities.find((e) => e.title === `Meal One ${tag}`);
  expect(feed.logs.find((l) => l.entityId === film!.id)!.peopleIds).toEqual([palId]);
  expect(feed.logs.find((l) => l.entityId === meal!.id)!.peopleIds).toEqual([palId]);
  await assertReplicaClean(page);
});

test("the same new title logged twice offline → one entity, two logs", async ({ page, context }) => {
  const tag = `graph-dup-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "movie", { title: `Rewatch ${tag}`, notes: "first time" });
  await addLog(page, "movie", { title: `Rewatch ${tag}`, notes: "second time" });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === `Rewatch ${tag}`));
  const ents = feed.entities.filter((e) => e.title === `Rewatch ${tag}`);
  expect(ents).toHaveLength(1);
  const logs = feed.logs.filter((l) => l.entityId === ents[0].id);
  expect(logs.map((l) => l.notes).sort()).toEqual(["first time", "second time"]);
  await assertReplicaClean(page);
});

test("create A, create B, delete A — all offline in one batch → server has B, not A", async ({
  page,
  context,
}) => {
  const tag = `graph-order-${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "movie", { title: `A ${tag}` });
  await addLog(page, "movie", { title: `B ${tag}` });

  await openEntity(page, `A ${tag}`);
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === `B ${tag}`));
  expect(feed.entities.some((e) => e.title === `B ${tag}`)).toBe(true);
  // A's entity may or may not exist (an orphan entity.create can still land) — but it must have
  // no live log, and the log that was created for it must be gone.
  const a = feed.entities.find((e) => e.title === `A ${tag}`);
  if (a) expect(feed.logs.some((l) => l.entityId === a.id)).toBe(false);
  await assertReplicaClean(page);
});

test("edit then delete the same log offline → ends deleted", async ({ page, context }) => {
  const tag = `graph-ed-${Date.now().toString(36)}`;
  await addLog(page, "movie", { title: `EditDelete ${tag}` });
  await syncFromSettings(page);
  const seeded = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === `EditDelete ${tag}`));
  const entId = seeded.entities.find((e) => e.title === `EditDelete ${tag}`)?.id;
  const logId = seeded.logs.find((l) => l.entityId === entId)?.id;

  await context.setOffline(true);
  await openEntity(page, `EditDelete ${tag}`);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.locator("textarea").first().fill("pointless edit");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("pointless edit")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(
    page.request,
    (f) => f.deletions.some((d) => d.entityType === "log" && d.id === logId),
  );
  expect(feed.logs.some((l) => l.id === logId)).toBe(false);
  expect(feed.deletions.some((d) => d.entityType === "log" && d.id === logId)).toBe(true);
  await assertReplicaClean(page);
});

test("writes survive repeated offline/online flaps with a sync between each", async ({ page, context }) => {
  const tag = `graph-flap-${Date.now().toString(36)}`;

  for (const n of [1, 2, 3]) {
    await context.setOffline(true);
    await addLog(page, "movie", { title: `Flap ${tag} ${n}` });
    await context.setOffline(false);
    await syncFromSettings(page);
    expect(await outboxCount(page)).toBe(0);
  }

  const feed = await feedWhere(page.request, (f) => [1, 2, 3].every((n) => f.entities.some((e) => e.title === `Flap ${tag} ${n}`)));
  for (const n of [1, 2, 3]) {
    const ent = feed.entities.find((e) => e.title === `Flap ${tag} ${n}`);
    expect(ent!.id).toBeGreaterThan(0);
    expect(feed.logs.some((l) => l.entityId === ent!.id)).toBe(true);
  }
  await assertReplicaClean(page);
});

test("writes survive a full reload mid-session, then a later sync", async ({ page, context }) => {
  const tag = `graph-reload-${Date.now().toString(36)}`;

  await context.setOffline(true);
  await addLog(page, "movie", { title: `Before ${tag}` });

  // Full reload while still offline and un-synced.
  await page.reload();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  expect(await outboxCount(page)).toBeGreaterThanOrEqual(2);

  await addLog(page, "movie", { title: `After ${tag}` });
  await context.setOffline(false);
  await syncFromSettings(page);

  const feed = await feedWhere(
    page.request,
    (f) => f.entities.some((e) => e.title === `Before ${tag}`) && f.entities.some((e) => e.title === `After ${tag}`),
  );
  expect(feed.entities.find((e) => e.title === `Before ${tag}`)!.id).toBeGreaterThan(0);
  expect(feed.entities.find((e) => e.title === `After ${tag}`)!.id).toBeGreaterThan(0);
  await assertReplicaClean(page);
  // The replica's stored cursor advanced past the bootstrap.
  const cursor = (await readStore<{ key: string; value: unknown }>(page, "logger", "meta")).find(
    (r) => r.key === "syncCursor",
  )?.value;
  expect(Number(cursor)).toBeGreaterThan(0);
});
