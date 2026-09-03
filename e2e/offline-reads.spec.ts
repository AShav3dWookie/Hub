import { test, expect } from "@playwright/test";
import { gotoHome, readStore } from "./helpers/app";

/**
 * With reads served from the IndexedDB replica, the app keeps working after the network
 * drops — as long as the page isn't reloaded (the app shell still needs the service worker,
 * which lands in a later branch). Client-side navigation + queries must resolve offline.
 */
test("browses cached data after going offline (client-side nav)", async ({ page, context }) => {
  await gotoHome(page);

  // Let the app-open sync fill the replica.
  await expect
    .poll(async () => (await readStore(page, "logger", "logs")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  await context.setOffline(true);
  try {
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page.getByRole("textbox").first().fill("Interstellar");
    await expect(page.getByText("Interstellar").first()).toBeVisible();
    await page.getByText("Interstellar").first().click();
    await expect(page).toHaveURL(/\/(entity|person)\/\d+/);

    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
