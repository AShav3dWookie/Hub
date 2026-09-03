import { test, expect } from "@playwright/test";
import { gotoHome, serviceWorkerState } from "./helpers/app";

/**
 * Thumbnails are permanent offline data: the sync engine warms `logger-thumbs` with every
 * photo it learns about, so the gallery grid renders offline even for images never opened.
 * The full-size original is not cached (that's a later tier) — the Lightbox shows a
 * placeholder for it offline.
 */
test("gallery thumbnails render offline; the full image shows an offline placeholder", async ({
  page,
  context,
}) => {
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");

  // Warm the thumbnail cache: open the gallery online first, then let the sync engine's
  // warm-on-pull run.
  await page.getByRole("link", { name: "Gallery", exact: true }).click();
  await expect(page.getByRole("img").first()).toBeVisible();

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          if (!("caches" in window)) return 0;
          const cache = await caches.open("logger-thumbs");
          return (await cache.keys()).length;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  await context.setOffline(true);
  try {
    await page.reload();
    // The grid still paints its thumbnails from the cache.
    const firstThumb = page.getByRole("img").first();
    await expect(firstThumb).toBeVisible();
    await expect(firstThumb).toHaveJSProperty("complete", true);
    await expect(firstThumb).not.toHaveJSProperty("naturalWidth", 0);

    // Opening a photo: the original isn't cached → placeholder.
    await firstThumb.click();
    await expect(page.getByText(/unavailable offline/i)).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
