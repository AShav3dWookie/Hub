import { test, expect } from "@playwright/test";
import { gotoHome, serviceWorkerState } from "./helpers/app";

/**
 * The service-worker half of the wedged-session fix, against the real built worker.
 *
 * A device whose session went away used to be stuck: `/api/auth/status` was served from a
 * `logger-auth` NetworkFirst cache with a 3-second timeout and no expiration, so one slow
 * response on mobile data cached "signed in" permanently — the app rendered normally while
 * every request 401'd, and nothing could discover it. The unit suite covers the routing table;
 * only a browser can confirm the built worker behaves the same way and clears the old cache.
 *
 * Auth is off in this rig (see e2e/serve.mjs), which is fine — neither assertion needs a
 * session, and the sign-out journeys are covered in client/src/api/sessionRecovery.test.tsx.
 */

const cacheNames = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ("caches" in window ? caches.keys() : []));

test("the worker never caches auth status", async ({ page }) => {
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");

  // Exercise the route the old worker would have cached.
  const statuses = await page.evaluate(async () => {
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch("/api/auth/status", { credentials: "include" });
      codes.push(res.status);
    }
    return codes;
  });
  expect(statuses).toEqual([200, 200, 200]);

  // A caching strategy writes to the cache *after* handing back the response, so an immediate
  // read of caches.keys() would miss it and pass against the very worker this guards against.
  await page.waitForTimeout(2_000);
  expect(await cacheNames(page)).not.toContain("logger-auth");
});

test("a new worker deletes a logger-auth cache left by an older build", async ({ page }) => {
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");

  // Stand in for the cache an older build wrote: a stale "signed in" that outlived the session.
  await page.evaluate(async () => {
    const cache = await caches.open("logger-auth");
    await cache.put(
      "/api/auth/status",
      new Response(JSON.stringify({ authRequired: true, authenticated: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  expect(await cacheNames(page)).toContain("logger-auth");

  // Drop the worker so the next load installs and activates a fresh one. Caches are
  // origin-scoped, so the seeded one survives this and is still there for `activate` to find.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.unregister();
  });
  await page.reload();
  expect(await serviceWorkerState(page)).toBe("activated");

  await expect.poll(async () => await cacheNames(page), { timeout: 10_000 }).not.toContain(
    "logger-auth",
  );
});
