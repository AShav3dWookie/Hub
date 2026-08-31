import { test, expect } from "@playwright/test";
import { gotoHome, readStore, serviceWorkerState } from "./helpers/app";

/**
 * The service-worker app shell: installable manifest, and — the point of the whole thing —
 * the app still loads after a full reload with the network down.
 */
test.describe("PWA shell", () => {
  test("serves a valid web manifest with icons", async ({ page, request }) => {
    await gotoHome(page);

    const href = await page.getAttribute('link[rel="manifest"]', "href");
    expect(href).toBeTruthy();

    const res = await request.get(href!);
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest).toMatchObject({ name: "Logger", display: "standalone", start_url: "/" });
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  test("reloads and renders offline once the shell is cached", async ({ page, context }) => {
    await gotoHome(page);
    expect(await serviceWorkerState(page)).toBe("activated");
    // let the app-open sync fill the replica so there's data to render offline
    await expect
      .poll(async () => (await readStore(page, "logger", "logs")).length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();

      await page.getByRole("link", { name: "Search", exact: true }).click();
      await page.getByRole("textbox").first().fill("Interstellar");
      await expect(page.getByText("Interstellar").first()).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("index.html and sw.js are served no-cache", async ({ request }) => {
    for (const path of ["/", "/sw.js"]) {
      const res = await request.get(path);
      expect(res.ok()).toBeTruthy();
      expect(res.headers()["cache-control"] ?? "").toContain("no-cache");
    }
    const asset = await request.get("/");
    const html = await asset.text();
    const match = html.match(/\/assets\/[^"']+\.js/);
    if (match) {
      const assetRes = await request.get(match[0]);
      expect(assetRes.headers()["cache-control"] ?? "").toContain("immutable");
    }
  });
});
