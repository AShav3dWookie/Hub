import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end / PWA test config.
 *
 * These tests drive the **production build** of the app (service workers are disabled under
 * `vite dev`), served on its own port against a throwaway, freshly-seeded SQLite database by
 * `e2e/serve.mjs`. They never touch the user's port 3000 docker instance or `test-env/`.
 *
 * The one project emulates a Pixel 7 (Chromium / Blink — the same engine as Chrome on
 * Android, which is the PWA's target platform). Periodic Background Sync cannot be exercised
 * headlessly (Chrome gates it on site-engagement heuristics); that path is unit-tested at
 * the `runSync()` level instead.
 *
 *   npm run test:e2e                 # build, serve, run
 *   E2E_SKIP_BUILD=1 npm run test:e2e  # reuse the last build (fast iteration)
 *   npx playwright show-report e2e/.artifacts/report
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts/test-results",
  // One server + one SQLite file are shared across the run, so tests run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["html", { outputFolder: "e2e/.artifacts/report", open: "never" }],
  ],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
