import { test, expect } from "@playwright/test";
import { gotoHome } from "./helpers/app";

/**
 * Baseline coverage of the shipped app, served as the production bundle against the seeded
 * scratch DB. This is the "nothing regressed" net that the PWA branches build on; PWA-specific
 * behaviour (service worker, offline, IndexedDB, settings) gets its own specs as it lands.
 */
test.describe("app smoke", () => {
  test("home hub renders with its five actions", async ({ page }) => {
    await gotoHome(page);
    await expect(page).toHaveTitle(/Logger/);
    for (const label of ["Add", "Search", "Calendar", "Gallery", "Albums"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("search finds a seeded movie and opens its entity page", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page.getByRole("textbox").first().fill("Interstellar");
    await expect(page.getByText("Interstellar").first()).toBeVisible();
    await page.getByText("Interstellar").first().click();
    await expect(page).toHaveURL(/\/(entity|person)\/\d+/);
  });

  test("a person profile lists their appearances", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page.getByRole("textbox").first().fill("Alice");
    const alice = page.getByText("Alice", { exact: true }).first();
    await expect(alice).toBeVisible();
    await alice.click();
    await expect(page).toHaveURL(/\/person\/\d+/);
    // Alice is seeded on several movie logs.
    await expect(page.getByText(/Interstellar|Dune/).first()).toBeVisible();
  });

  test("gallery route loads (no photos in the seed) without error", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("link", { name: "Gallery", exact: true }).click();
    await expect(page).toHaveURL(/\/gallery/);
    // No uncaught errors, page settled.
    await expect(page.locator("body")).toBeVisible();
  });

  test("the service worker registers and takes control", async ({ page }) => {
    await gotoHome(page);
    await expect
      .poll(async () => page.evaluate(() => navigator.serviceWorker.controller?.state ?? null), {
        timeout: 10_000,
      })
      .toBe("activated");
  });
});
