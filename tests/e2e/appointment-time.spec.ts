import { test, expect } from "@playwright/test";
import { enterEditMode, gotoHome, readStore, syncFromSettings } from "./helpers/app";
import { addLog, assertReplicaClean, bootstrap, feedWhere, openEntity } from "./helpers/writes";

/**
 * An appointment's optional time of day (#15), driven through the built app on the phone
 * layout: picked in the add form, shown on Home and in the calendar, changed in the edit form,
 * and carried through an offline write.
 */

/** YYYY-MM-DD `days` from today, inside Home's next-7-days window. */
function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
  await bootstrap(page);
});

test("a timed appointment shows its time on Home, in the calendar and on its page, and can be changed", async ({
  page,
}) => {
  const title = `Dentist ${Date.now().toString(36)}`;
  const date = inDays(3);
  await addLog(page, "appointment", { title, date, time: "15:00" });

  // Home: the time sits beside the weekday.
  await gotoHome(page);
  const row = page.getByRole("link").filter({ hasText: title });
  await expect(row).toContainText("15:00");

  // Calendar: the day's list shows the time before the title.
  await page.goto(`/calendar?date=${date}`);
  const item = page.getByRole("link").filter({ hasText: title });
  await expect(item).toContainText("15:00");

  // Its page, then an edit to 09:30.
  await openEntity(page, title);
  await expect(page.getByText(`${date} at 15:00`)).toBeVisible();
  await enterEditMode(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("Time (optional)").fill("09:30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`${date} at 09:30`)).toBeVisible();

  await syncFromSettings(page);
  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === title));
  const entity = feed.entities.find((e) => e.title === title)!;
  expect(feed.logs.find((l) => l.entityId === entity.id)).toMatchObject({ date, time: "09:30" });
});

test("an appointment left untimed stays untimed", async ({ page }) => {
  const title = `Bins ${Date.now().toString(36)}`;
  await addLog(page, "appointment", { title, date: inDays(2) });
  await syncFromSettings(page);

  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === title));
  const entity = feed.entities.find((e) => e.title === title)!;
  expect(feed.logs.find((l) => l.entityId === entity.id)?.time).toBeNull();
});

test("a time picked offline is queued, and lands on the hub after sync", async ({ page, context }) => {
  const title = `Physio ${Date.now().toString(36)}`;
  await context.setOffline(true);
  await addLog(page, "appointment", { title, date: inDays(4), time: "11:15" });

  const queued = await readStore<{ type: string; payload: { time?: string | null } }>(page, "logger", "outbox");
  expect(queued.find((e) => e.type === "log.create")?.payload.time).toBe("11:15");

  await context.setOffline(false);
  await syncFromSettings(page);
  const feed = await feedWhere(page.request, (f) => f.entities.some((e) => e.title === title));
  const entity = feed.entities.find((e) => e.title === title)!;
  expect(feed.logs.find((l) => l.entityId === entity.id)?.time).toBe("11:15");
  await assertReplicaClean(page);
});
