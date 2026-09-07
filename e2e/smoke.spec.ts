import { test, expect } from "@playwright/test";
import { gotoHome, gotoTab } from "./helpers/app";

/**
 * Baseline coverage of the shipped app, served as the production bundle against the seeded
 * scratch DB. This is the "nothing regressed" net that the PWA branches build on; PWA-specific
 * behaviour (service worker, offline, IndexedDB, settings) gets its own specs as it lands.
 */
test.describe("app smoke", () => {
  test("every tab destination is one tap away from home", async ({ page }) => {
    await gotoHome(page);
    await expect(page).toHaveTitle(/Logger/);
    for (const label of ["Home", "Search", "Add", "Calendar", "Gallery"]) {
      await expect(
        page.getByRole("navigation").getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    }
  });

  test("albums are reachable from the gallery's Photos/Albums toggle", async ({ page }) => {
    await gotoHome(page);
    await gotoTab(page, "Gallery");
    await page.getByRole("link", { name: "Albums" }).click();
    await expect(page).toHaveURL(/\/albums/);
  });

  test("search finds a seeded movie and opens its entity page", async ({ page }) => {
    await gotoHome(page);
    await gotoTab(page, "Search");
    await page.getByRole("textbox").first().fill("Interstellar");
    await expect(page.getByText("Interstellar").first()).toBeVisible();
    await page.getByText("Interstellar").first().click();
    await expect(page).toHaveURL(/\/(entity|person)\/\d+/);
  });

  test("a person profile lists their appearances", async ({ page }) => {
    await gotoHome(page);
    await gotoTab(page, "Search");
    await page.getByRole("textbox").first().fill("Alice");
    const alice = page.getByText("Alice", { exact: true }).first();
    await expect(alice).toBeVisible();
    await alice.click();
    await expect(page).toHaveURL(/\/person\/\d+/);
    // Alice is seeded on several movie logs.
    await expect(page.getByText(/Interstellar|Dune/).first()).toBeVisible();
  });

  test("gallery route shows the seeded photos", async ({ page }) => {
    await gotoHome(page);
    await gotoTab(page, "Gallery");
    await expect(page).toHaveURL(/\/gallery/);
    await expect(page.getByRole("img").first()).toBeVisible();
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
