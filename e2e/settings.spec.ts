import { test, expect } from "@playwright/test";
import { gotoHome, serviceWorkerState } from "./helpers/app";

test.describe("Settings", () => {
  test("reachable from the bottom bar; shows sync + cache, and syncs on demand", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings/);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Online")).toBeVisible();
    await expect(page.getByText("Last sync")).toBeVisible();
    // Background sync resolves to a real state (headless Chromium can't grant it).
    await expect(page.getByText("Background sync", { exact: true })).toBeVisible();
    await expect(page.getByText(/Not available on this device|Off — allow|On — daily/)).toBeVisible();

    await page.getByRole("button", { name: /sync now/i }).click();
    // it settles back out of the syncing state
    await expect(page.getByRole("button", { name: /sync now/i })).toBeEnabled();

    // thumbnails got warmed by the app-open sync
    await expect(page.getByText(/Cached thumbnails/)).toBeVisible();
    await page.getByRole("button", { name: /clear thumbnails/i }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const c = await caches.open("logger-thumbs");
          return (await c.keys()).length;
        }),
      )
      .toBe(0);
  });

  test("add forms still work while offline (queued locally)", async ({ page, context }) => {
    await gotoHome(page);
    expect(await serviceWorkerState(page)).toBe("activated");
    await context.setOffline(true);
    try {
      await page.goto("/add/movie");
      await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
      await page.getByLabel("Title").fill(`Queued while offline ${Date.now()}`);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();

      // The write went to the outbox, not the network.
      const outbox = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open("logger");
            open.onsuccess = () => {
              const db = open.result;
              const req = db.transaction("outbox", "readonly").objectStore("outbox").count();
              req.onsuccess = () => {
                db.close();
                resolve(req.result);
              };
            };
          }),
      );
      expect(outbox).toBeGreaterThan(0);
    } finally {
      await context.setOffline(false);
    }
  });
});
