import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerPeriodicSync, periodicSyncStatus, PERIODIC_SYNC_TAG } from "./periodicSync.js";

interface FakeManager {
  register: ReturnType<typeof vi.fn>;
  getTags: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
}

function fakeManager(): FakeManager {
  return {
    register: vi.fn().mockResolvedValue(undefined),
    getTags: vi.fn().mockResolvedValue([]),
    unregister: vi.fn().mockResolvedValue(undefined),
  };
}

function stubServiceWorker(reg: object | null) {
  vi.stubGlobal("navigator", {
    ...navigator,
    serviceWorker: {
      ready: reg ? Promise.resolve(reg) : new Promise(() => {}),
      getRegistration: () => Promise.resolve(reg ?? undefined),
    },
    permissions: {
      query: vi.fn().mockResolvedValue({ state: "granted" }),
    },
  });
}

describe("periodicSync", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("registers the daily tag when supported and permitted", async () => {
    const manager = fakeManager();
    stubServiceWorker({ periodicSync: manager });

    expect(await registerPeriodicSync()).toBe("active");
    expect(manager.register).toHaveBeenCalledWith(PERIODIC_SYNC_TAG, {
      minInterval: 12 * 60 * 60 * 1000,
    });
  });

  it("reports 'unsupported' when the API is missing", async () => {
    stubServiceWorker({}); // registration with no periodicSync
    expect(await registerPeriodicSync()).toBe("unsupported");
  });

  it("reports 'denied' when the permission isn't granted", async () => {
    stubServiceWorker({ periodicSync: fakeManager() });
    (navigator.permissions.query as ReturnType<typeof vi.fn>).mockResolvedValue({ state: "prompt" });
    expect(await registerPeriodicSync()).toBe("denied");
  });

  it("reports 'error' when register throws (e.g. engagement too low)", async () => {
    const manager = fakeManager();
    manager.register.mockRejectedValue(new Error("not allowed"));
    stubServiceWorker({ periodicSync: manager });
    expect(await registerPeriodicSync()).toBe("error");
  });

  it("periodicSyncStatus reflects a registered tag", async () => {
    const manager = fakeManager();
    manager.getTags.mockResolvedValue([PERIODIC_SYNC_TAG]);
    stubServiceWorker({ periodicSync: manager });
    expect(await periodicSyncStatus()).toBe("active");

    manager.getTags.mockResolvedValue([]);
    expect(await periodicSyncStatus()).toBe("denied");
  });
});
