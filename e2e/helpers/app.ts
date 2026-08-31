import type { Page } from "@playwright/test";

/** Navigate to the home hub and wait for the SPA to render it. */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("heading", { name: "What would you like to do?" }).waitFor();
}

/**
 * The state of the page's active service worker (`"activated"`, `"installing"`, …),
 * or `null` when nothing is registered. Polls briefly since registration is async.
 */
export async function serviceWorkerState(page: Page, timeoutMs = 10_000): Promise<string | null> {
  return page.evaluate(async (timeout) => {
    if (!("serviceWorker" in navigator)) return null;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const reg = await navigator.serviceWorker.getRegistration();
      const worker = reg?.active ?? reg?.waiting ?? reg?.installing ?? null;
      if (worker) return worker.state;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }, timeoutMs);
}

/** Read every record from an IndexedDB object store, in the page's origin. `[]` if absent. */
export async function readStore<T = unknown>(
  page: Page,
  dbName: string,
  storeName: string,
): Promise<T[]> {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise<T[]>((resolve, reject) => {
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
      }),
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
