import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureCurrentShell } from "./shellVersion.js";
import { THUMB_CACHE } from "../sync/thumbnailCache.js";
import { setMeta, getMeta, META_SYNC_CURSOR } from "../local/db.js";

/**
 * The recovery for a shell frozen on an older build.
 *
 * This exists because the service worker's own update check can be answered with a stale
 * `/sw.js` by anything between the app and the origin, and when that happens the app is stuck
 * with no symptom beyond "nothing reaches the server". The only known cure was clearing site
 * data — which also destroys the replica and every write queued offline, and is not something
 * you can ask of someone using an installed app. Hence the IndexedDB assertions below.
 */

const BUILT = "1.2.0";

let cacheStore: string[];
let deleted: string[];
let reload: ReturnType<typeof vi.fn>;

function stubCaches() {
  deleted = [];
  vi.stubGlobal("caches", {
    keys: async () => [...cacheStore],
    delete: async (name: string) => {
      deleted.push(name);
      cacheStore = cacheStore.filter((n) => n !== name);
      return true;
    },
  });
}

function stubHealth(version: string | undefined, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ version }) })),
  );
}

/** A registration whose `update()` produces a newly installing worker, or nothing. */
function stubRegistration(opts: { producesWorker: boolean } | null) {
  const unregister = vi.fn(async () => true);
  const update = vi.fn(async () => undefined);
  if (opts === null) {
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => undefined } });
    return { unregister, update };
  }
  const worker = {
    state: opts.producesWorker ? "activated" : "activated",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const registration = {
    update,
    unregister,
    get installing() {
      return opts.producesWorker ? worker : null;
    },
    get waiting() {
      return null;
    },
  };
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => registration } });
  return { unregister, update };
}

beforeEach(() => {
  vi.stubEnv("VITE_APP_VERSION", BUILT);
  cacheStore = ["workbox-precache-v2-https://hub.example/", "logger-auth", THUMB_CACHE];
  reload = vi.fn();
  sessionStorage.clear();
  stubCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("when the shell is current", () => {
  it("does nothing at all", async () => {
    stubHealth(BUILT);
    stubRegistration({ producesWorker: true });

    await ensureCurrentShell({ reload });

    expect(reload).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it("forgets earlier recovery attempts, so a later drift gets a full pair of tries", async () => {
    sessionStorage.setItem("logger:shell-refresh-attempts", "2");
    stubHealth(BUILT);
    stubRegistration({ producesWorker: true });

    await ensureCurrentShell({ reload });

    expect(sessionStorage.getItem("logger:shell-refresh-attempts")).toBeNull();
  });
});

describe("when the server cannot be reached", () => {
  it("leaves the offline app alone", async () => {
    // Opening offline is a supported thing, not a stale shell.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    stubRegistration({ producesWorker: true });

    await ensureCurrentShell({ reload });

    expect(reload).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it("does nothing when health responds without a version", async () => {
    stubHealth(undefined);
    stubRegistration({ producesWorker: true });

    await ensureCurrentShell({ reload });

    expect(reload).not.toHaveBeenCalled();
  });
});

describe("when the shell is stale and the worker can update", () => {
  it("updates the worker and reloads onto the new build", async () => {
    stubHealth("1.3.0");
    const { update, unregister } = stubRegistration({ producesWorker: true });

    await ensureCurrentShell({ reload });

    expect(update).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // The worker is doing its job — don't tear it down.
    expect(unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });
});

describe("when the shell is stale and the worker will not update", () => {
  it("removes the worker and the shell caches, then reloads", async () => {
    // The real case: a stale /sw.js upstream, so update() finds nothing to install.
    stubHealth("1.3.0");
    const { update, unregister } = stubRegistration({ producesWorker: false });

    await ensureCurrentShell({ reload });

    expect(update).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleted).toContain("workbox-precache-v2-https://hub.example/");
    expect(deleted).toContain("logger-auth");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the thumbnail cache, which is offline data rather than app code", async () => {
    stubHealth("1.3.0");
    stubRegistration({ producesWorker: false });

    await ensureCurrentShell({ reload });

    expect(deleted).not.toContain(THUMB_CACHE);
    expect(cacheStore).toContain(THUMB_CACHE);
  });

  it("never touches IndexedDB, so the replica and the outbox survive", async () => {
    // Clearing site data fixes a stale shell and takes the user's queued writes with it. This
    // recovery has to be the version you can run without losing anything.
    await setMeta(META_SYNC_CURSOR, "4821");
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { ...globalThis.indexedDB, deleteDatabase });

    stubHealth("1.3.0");
    stubRegistration({ producesWorker: false });

    await ensureCurrentShell({ reload });

    expect(deleteDatabase).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    stubCaches();
    expect(await getMeta(META_SYNC_CURSOR)).toBe("4821");
  });
});

describe("the reload-loop guard", () => {
  it("gives up after two attempts rather than reloading forever", async () => {
    // A version that can never match — a half-finished deploy, say — must not trap the app in a
    // reload loop.
    stubHealth("9.9.9");

    stubRegistration({ producesWorker: false });
    await ensureCurrentShell({ reload });
    expect(reload).toHaveBeenCalledTimes(1);

    stubCaches();
    stubRegistration({ producesWorker: false });
    await ensureCurrentShell({ reload });
    expect(reload).toHaveBeenCalledTimes(2);

    stubCaches();
    stubRegistration({ producesWorker: false });
    await ensureCurrentShell({ reload });
    expect(reload).toHaveBeenCalledTimes(2); // stopped
  });
});

describe("a dev build", () => {
  it("is left alone, having no version to compare", async () => {
    vi.stubEnv("VITE_APP_VERSION", "dev");
    stubHealth("1.3.0");
    stubRegistration({ producesWorker: false });

    await ensureCurrentShell({ reload });

    expect(reload).not.toHaveBeenCalled();
  });
});
