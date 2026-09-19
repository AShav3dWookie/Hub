import { THUMB_CACHE } from "../sync/thumbnailCache.js";

/**
 * Force the app onto the build the server is actually serving.
 *
 * The service worker's own update check is not enough on its own. It asks for `/sw.js`, and
 * anything between the app and the origin can answer that with a stale copy — or, via a
 * `Cache-Control` the origin never sent, tell the browser not to ask again for hours. When that
 * happens the app is frozen on an old shell with no symptom beyond "nothing reaches the server",
 * and the only cure was clearing site data, which also destroys the local replica and every write
 * queued offline. That is not a thing to ask of someone using an installed app.
 *
 * So this does not rely on the worker noticing. `/api/health` reports the version the server is
 * serving, the bundle knows the version it was built as, and a mismatch means the shell is stale
 * by definition.
 *
 * **IndexedDB is never touched.** The replica and the outbox are the one thing that has to
 * survive a recovery, so only the caches the shell is served from are dropped — and not the
 * thumbnail cache, which is real offline data rather than app code.
 */

/** Attempts are per tab-session, so a relaunch always gets a fresh pair of tries. */
const ATTEMPT_KEY = "logger:shell-refresh-attempts";
const MAX_ATTEMPTS = 2;
/** How long to let a newly installed worker reach `activated` before reloading anyway. */
const ACTIVATION_TIMEOUT_MS = 5_000;

export interface ShellVersionDeps {
  /** Injected so a test can observe the reload instead of navigating. */
  reload: () => void;
}

function readAttempts(): number {
  try {
    return Number(sessionStorage.getItem(ATTEMPT_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function writeAttempts(n: number | null): void {
  try {
    if (n === null) sessionStorage.removeItem(ATTEMPT_KEY);
    else sessionStorage.setItem(ATTEMPT_KEY, String(n));
  } catch {
    // Private mode, or storage disabled. Losing the guard costs a reload, not correctness.
  }
}

/** Every cache except the thumbnails: those are offline data, not the app shell. */
async function clearShellCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys().catch(() => [] as string[]);
  await Promise.all(
    names.filter((n) => n !== THUMB_CACHE).map((n) => caches.delete(n).catch(() => false)),
  );
}

/** Resolve once `worker` is activated, or after {@link ACTIVATION_TIMEOUT_MS}, whichever first. */
function whenActivated(worker: ServiceWorker): Promise<void> {
  if (worker.state === "activated") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      worker.removeEventListener("statechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (worker.state === "activated" || worker.state === "redundant") done();
    };
    const timer = setTimeout(done, ACTIVATION_TIMEOUT_MS);
    worker.addEventListener("statechange", onChange);
  });
}

/**
 * Compare the running bundle against what the server serves, and recover if they disagree.
 *
 * Does nothing when the versions match, when the build has no version baked in (a dev build), or
 * when the server cannot be reached — opening offline is a supported thing, not a fault.
 */
export async function ensureCurrentShell(
  { reload }: ShellVersionDeps = { reload: () => location.reload() },
): Promise<void> {
  const built = import.meta.env.VITE_APP_VERSION;
  if (!built || built === "dev") return;

  let serving: string | undefined;
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return;
    serving = ((await res.json()) as { version?: string }).version;
  } catch {
    return;
  }

  if (!serving || serving === built) {
    writeAttempts(null);
    return;
  }

  const attempts = readAttempts();
  if (attempts >= MAX_ATTEMPTS) return; // it did not work twice; stop rather than reload-loop
  writeAttempts(attempts + 1);

  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);

  if (registration) {
    await registration.update().catch(() => undefined);
    const pending = registration.installing ?? registration.waiting;
    if (pending) {
      // A new worker exists, so the update did land. It calls skipWaiting/clientsClaim itself;
      // the reload is what swaps the running bundle for the shell it just precached.
      await whenActivated(pending);
      reload();
      return;
    }
    // `update()` found nothing to install. The worker is not going to fix this — the copy of
    // /sw.js it can see is stale — so don't spend a reload discovering that again.
    await registration.unregister().catch(() => undefined);
  }

  await clearShellCaches();
  reload();
}
