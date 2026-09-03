import type { Page } from "@playwright/test";

/** Navigate to the home hub and wait for the SPA to render it. */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("heading", { name: "What would you like to do?" }).waitFor();
}

/**
 * Waits for the page's service worker to have an **active** worker and returns its state
 * (normally `"activated"`), or `null` if none activates within `timeoutMs`.
 */
export async function serviceWorkerState(page: Page, timeoutMs = 15_000): Promise<string | null> {
  return page.evaluate(async (timeout) => {
    if (!("serviceWorker" in navigator)) return null;
    const deadline = Date.now() + timeout;
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(r, timeout)),
    ]);
    let state: string | null = null;
    while (Date.now() < deadline) {
      const reg = await navigator.serviceWorker.getRegistration();
      state = reg?.active?.state ?? null;
      if (state === "activated") return state;
      await new Promise((r) => setTimeout(r, 100));
    }
    return state;
  }, timeoutMs);
}

/**
 * Read every record from an IndexedDB object store in the page's origin. `[]` if the database
 * doesn't exist yet — it never *creates* one (that would pre-empt the app's own schema
 * upgrade and wedge it).
 */
export async function readStore<T = unknown>(
  page: Page,
  dbName: string,
  storeName: string,
): Promise<T[]> {
  return page.evaluate(
    async ({ dbName, storeName }) => {
      const existing = await indexedDB.databases();
      if (!existing.some((d) => d.name === dbName)) return [] as T[];
      return new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve([]);
            return;
          }
          const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve(req.result as T[]);
          };
        };
      });
    },
    { dbName, storeName },
  );
}

/** Toggle the browser context offline for the duration of `fn`, then restore. */
export async function offline<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  await page.context().setOffline(true);
  try {
    return await fn();
  } finally {
    await page.context().setOffline(false);
  }
}

/** How many queued (pending + dead) mutation envelopes the outbox holds right now. */
export async function outboxCount(page: Page): Promise<number> {
  return (await readStore(page, "logger", "outbox")).length;
}

/**
 * Drive a sync from the Settings screen and wait for the outbox to fully drain. Assumes the
 * context is back online. Use after queuing offline writes to push them to the server.
 */
export async function syncFromSettings(page: Page, timeoutMs = 25_000): Promise<void> {
  // A just-clicked mutation writes to IndexedDB asynchronously; navigating before that commits
  // would abort the transaction and lose the queued envelope. Give it a beat to land.
  await page.waitForTimeout(500);
  await page.goto("/settings");
  const start = Date.now();
  let zeroSince: number | null = null;
  while (Date.now() - start < timeoutMs) {
    if ((await outboxCount(page)) === 0) {
      // Require the queue to stay empty for a beat: the push removes envelopes just before its
      // POST resolves, so a bare "count === 0" can still be a hair ahead of the server commit.
      zeroSince ??= Date.now();
      if (Date.now() - zeroSince >= 700) return;
      await page.waitForTimeout(200);
      continue;
    }
    zeroSince = null;
    const btn = page.getByRole("button", { name: /^(sync now|retry now)$/i }).first();
    if (await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  throw new Error(`outbox did not drain within ${timeoutMs}ms (still ${await outboxCount(page)})`);
}
