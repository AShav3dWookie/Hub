import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * The service worker's routing table and its housekeeping.
 *
 * `sw.ts` is normally only exercised in a real browser (e2e), but two things here are worth
 * pinning at this level because getting them wrong wedges a device silently rather than
 * failing anything: `/api/auth/status` must not be served from a cache, and the retired
 * `logger-auth` cache must actually be deleted on activation.
 */

class FakeStrategy {
  constructor(public readonly options: unknown) {}
}
class NetworkOnly extends FakeStrategy {}
class CacheFirst extends FakeStrategy {}
class NetworkFirst extends FakeStrategy {}

const registerRoute = vi.fn();
const precacheAndRoute = vi.fn();
const cleanupOutdatedCaches = vi.fn();
const clientsClaim = vi.fn();

vi.mock("workbox-core", () => ({ clientsClaim }));
vi.mock("workbox-precaching", () => ({
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL: vi.fn(() => vi.fn()),
}));
vi.mock("workbox-routing", () => ({
  registerRoute,
  NavigationRoute: class {
    constructor(public handler: unknown) {}
  },
}));
vi.mock("workbox-strategies", () => ({ NetworkOnly, CacheFirst, NetworkFirst }));
vi.mock("../sync/pull.js", () => ({ pullChanges: vi.fn().mockResolvedValue(undefined) }));

type Listener = (event: { waitUntil: (p: Promise<unknown>) => void; tag?: string }) => void;

const listeners = new Map<string, Listener>();
const deletedCaches: string[] = [];

beforeAll(async () => {
  vi.stubGlobal("self", {
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: {},
    clients: { matchAll: vi.fn(), openWindow: vi.fn() },
    location: { origin: "https://hub.example" },
    __WB_MANIFEST: [],
  });
  vi.stubGlobal("caches", {
    delete: vi.fn(async (name: string) => {
      deletedCaches.push(name);
      return true;
    }),
  });
  await import("./sw.js");
});

/** The strategy workbox would use for `url`, honouring registration order (first match wins). */
function strategyFor(pathname: string): unknown {
  const url = new URL(pathname, "https://hub.example");
  for (const [match, strategy] of registerRoute.mock.calls) {
    if (typeof match === "function" && match({ url, request: new Request(url.href) })) {
      return strategy;
    }
  }
  return undefined;
}

describe("service worker routing", () => {
  it("does not serve /api/auth/status from a cache", () => {
    // A cached auth status is what wedged a device: the app rendered as signed in, every
    // request 401'd, and the read that would have noticed was answered from the cache.
    expect(strategyFor("/api/auth/status")).toBeInstanceOf(NetworkOnly);
  });

  it("registers no cache-falling-back strategy at all", () => {
    const strategies = registerRoute.mock.calls.map(([, s]) => s);
    expect(strategies.some((s) => s instanceof NetworkFirst)).toBe(false);
  });

  it("still caches thumbnails, which are the offline gallery", () => {
    expect(strategyFor("/api/photos/abc_thumb.webp")).toBeInstanceOf(CacheFirst);
  });

  it("keeps the change feed and the rest of the API on the network", () => {
    expect(strategyFor("/api/sync/changes?since=0")).toBeInstanceOf(NetworkOnly);
    expect(strategyFor("/api/photos/abc.jpg")).toBeInstanceOf(NetworkOnly);
    expect(strategyFor("/api/logs")).toBeInstanceOf(NetworkOnly);
  });
});

describe("service worker activation", () => {
  it("deletes the retired logger-auth cache", async () => {
    // cleanupOutdatedCaches() only knows about Workbox's own precaches, so without this a
    // device already holding a stale "signed in" would keep it across every future deploy.
    const activate = listeners.get("activate");
    expect(activate).toBeDefined();

    const waited: Promise<unknown>[] = [];
    activate!({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);

    expect(deletedCaches).toContain("logger-auth");
  });

  it("holds activation open until the cleanup finishes", () => {
    // Without waitUntil the worker can be killed mid-delete and the cache survives.
    const waited: Promise<unknown>[] = [];
    listeners.get("activate")!({ waitUntil: (p) => waited.push(p) });
    expect(waited).toHaveLength(1);
  });
});
