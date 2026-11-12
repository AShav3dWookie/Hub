import { test, expect } from "@playwright/test";
import { gotoHome, readStore } from "./helpers/app";

/**
 * Branch 4 wires the app to pull the change-feed into IndexedDB on open. Reads still come
 * from the network at this point (branch 4b flips them) — this just proves the replica fills.
 */
test("opening the app populates the IndexedDB replica and stores a cursor", async ({ page }) => {
  await gotoHome(page);

  await expect
    .poll(async () => (await readStore(page, "logger", "logs")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await readStore(page, "logger", "entities")).length)
    .toBeGreaterThan(0);

  const cursor = await readStore<{ key: string; value: unknown }>(page, "logger", "meta").then(
    (rows) => rows.find((r) => r.key === "syncCursor")?.value,
  );
  expect(Number(cursor)).toBeGreaterThan(0);
});
