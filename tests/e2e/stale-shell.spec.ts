import { test, expect } from "@playwright/test";
import { gotoHome, serviceWorkerState } from "./helpers/app";

/**
 * Recovering a shell frozen on an older build, in a real browser.
 *
 * The worker's own update check asks for `/sw.js`, and a CDN can answer that with a stale copy —
 * which is how a live device sat on a three-week-old bundle while the server served a new one,
 * showing nothing but "can't reach the server". The only cure was clearing site data, which also
 * destroys the replica and every write queued offline.
 *
 * Here the build never changes, so `registration.update()` genuinely finds nothing to install —
 * the same dead end a pinned `/sw.js` produces. Only `/api/health` is made to disagree, which is
 * the signal `newerServingVersion` actually keys on.
 *
 * The full outcome — a device on build A ending up on build B with the CDN still pinning A's
 * `sw.js` — was verified separately against two real builds behind a proxy, with a control build
 * that had the fix removed staying stuck. That needs two bundles and an edge proxy, so it is not
 * automated here; this pins the machinery and the one guarantee that matters.
 */

const MARKER = "MARKER-4821";

/** A write only this device has — the thing clearing site data would take with it. */
async function seedLocalWrite(page: import("@playwright/test").Page) {
  await page.evaluate(async (marker) => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open("logger");
      r.onsuccess = () => res(r.result);
    });
    await new Promise((res) => {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ key: "syncCursor", value: marker });
      tx.oncomplete = res;
      tx.onerror = res;
    });
  }, MARKER);
}

async function readLocalWrite(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open("logger");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return "<no db>";
    return new Promise((res) => {
      const r = db.transaction("meta").objectStore("meta").get("syncCursor");
      r.onsuccess = () => res(r.result?.value ?? "<unset>");
      r.onerror = () => res("<err>");
    });
  });
}

test("a shell older than the server recovers without losing local data", async ({ page, context }) => {
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");
  await seedLocalWrite(page);

  // Warm the thumbnail cache so we can prove it is spared.
  await page.evaluate(async () => {
    const cache = await caches.open("logger-thumbs");
    await cache.put("/api/photos/seeded_thumb.webp", new Response("x"));
  });

  let loads = 0;
  page.on("load", () => (loads += 1));

  // The server has moved on. The worker cannot discover it — the build, and so `/sw.js`, is
  // unchanged — which is exactly the pinned-CDN dead end.
  // context.route, not page.route: the health check goes through the service worker, and only
  // the context sees a worker's requests.
  await context.route("**/api/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", version: "99.0.0" }),
    }),
  );

  await page.reload();
  await page.getByRole("heading", { name: "What's on" }).waitFor();
  await page.waitForTimeout(4000);

  // It reloaded itself rather than sitting on the stale shell.
  expect(loads).toBeGreaterThan(1);

  // The replica and anything queued in the outbox are still here. This is the whole point:
  // the recovery has to be the one you can run without losing work.
  expect(await readLocalWrite(page)).toBe(MARKER);

  // Offline photo data is not app code, so it is kept.
  expect(await page.evaluate(() => caches.keys())).toContain("logger-thumbs");
});

test("a shell matching the server is left alone", async ({ page }) => {
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");

  let loads = 0;
  page.on("load", () => (loads += 1));

  await page.reload();
  await page.getByRole("heading", { name: "What's on" }).waitFor();
  await page.waitForTimeout(4000);

  // Exactly the one reload we asked for — no recovery, no loop.
  expect(loads).toBe(1);
});
