import { test, expect, type Page } from "@playwright/test";
import { gotoHome, serviceWorkerState } from "./helpers/app";

/**
 * A resumed app moving onto a newly deployed build, in a real browser.
 *
 * After 1.3.0 went out, the installed app on the phone kept saying 1.2.0 until it was swiped out
 * of recents: Android resumes an installed app rather than relaunching it, and the version check
 * only ran at launch. Now it also runs on the way back to the foreground — but never at the cost
 * of a form someone is halfway through.
 *
 * As in `stale-shell.spec.ts`, the build never changes; only `/api/health` is made to report a
 * newer version, which is the signal the check keys on. The clock is Playwright's so the resume
 * throttle can be skipped past rather than waited out.
 */

/** Past the resume check's throttle (`RESUME_CHECK_INTERVAL_MS`, five minutes). */
const PAST_THROTTLE = "05:01";

/**
 * Background the app and bring it back. Headless Chromium never really hides a page, so the
 * visibility the app reads is overridden and the event it listens for is dispatched.
 */
async function leaveAndReturn(page: Page) {
  await page.evaluate(() => {
    const become = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    become("hidden");
    become("visible");
  });
}

/** The server has moved on to a newer build. */
async function deployNewerBuild(page: Page) {
  // context.route, not page.route: the health check goes through the service worker, and only
  // the context sees a worker's requests.
  await page.context().route("**/api/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", version: "99.0.0" }),
    }),
  );
}

function countLoads(page: Page) {
  const counter = { loads: 0 };
  page.on("load", () => (counter.loads += 1));
  return counter;
}

test("a resumed app moves onto a newly deployed build", async ({ page }) => {
  await page.clock.install();
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");
  await page.waitForTimeout(1500); // the launch check: current, so nothing happens

  const counter = countLoads(page);
  await deployNewerBuild(page);
  await page.clock.fastForward(PAST_THROTTLE);
  await leaveAndReturn(page);

  await expect.poll(() => counter.loads, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("returning within the throttle does not ask the server again", async ({ page }) => {
  await page.clock.install();
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");
  await page.waitForTimeout(1500);

  let healthChecks = 0;
  await page.context().route("**/api/health", (route) => {
    healthChecks += 1;
    return route.continue();
  });
  await leaveAndReturn(page);
  await page.waitForTimeout(3000);

  expect(healthChecks).toBe(0);
});

test("a half-filled form holds the update until it is tapped", async ({ page }) => {
  await page.clock.install();
  await gotoHome(page);
  expect(await serviceWorkerState(page)).toBe("activated");
  await page.goto("/add/movie");
  await page.getByLabel("Title").fill("Half-typed title");

  const counter = countLoads(page);
  await deployNewerBuild(page);
  await page.clock.fastForward(PAST_THROTTLE);
  await leaveAndReturn(page);

  const offer = page.getByRole("button", { name: "Hub 99.0.0 is ready — tap to update" });
  await expect(offer).toBeVisible({ timeout: 15_000 });
  // Offered, not taken: the form and what was typed into it are still there.
  expect(counter.loads).toBe(0);
  await expect(page.getByLabel("Title")).toHaveValue("Half-typed title");

  await offer.click();
  await expect.poll(() => counter.loads, { timeout: 15_000 }).toBeGreaterThan(0);
});
