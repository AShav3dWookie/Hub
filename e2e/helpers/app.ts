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
