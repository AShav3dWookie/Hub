import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  warmThumbnails,
  thumbnailCacheStats,
  clearThumbnailCache,
  THUMB_CACHE,
} from "./thumbnailCache.js";

/** Minimal in-memory Cache Storage — jsdom has none. */
class FakeCache {
  store = new Map<string, Response>();
  private key(req: unknown): string {
    if (typeof req === "string") return req;
    if (req && typeof req === "object" && "url" in req) return String((req as { url: unknown }).url);
    return String(req);
  }
  async match(req: unknown) {
    return this.store.get(this.key(req));
  }
  async add(req: unknown) {
    FakeCache.added.push(this.key(req));
    this.store.set(this.key(req), new Response(new Blob(["x".repeat(120)])));
  }
  async put(req: unknown, res: Response) {
    this.store.set(this.key(req), res);
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
  async delete(req: unknown) {
    return this.store.delete(this.key(req));
  }
  static added: string[] = [];
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)!;
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
  async has(name: string) {
    return this.caches.has(name);
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async match() {
    return undefined;
  }
}

let fake: FakeCacheStorage;

describe("thumbnailCache", () => {
  beforeEach(() => {
    fake = new FakeCacheStorage();
    FakeCache.added = [];
    vi.stubGlobal("caches", fake);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("warms only the thumbnails not already cached, deduping the input", async () => {
    const cache = await fake.open(THUMB_CACHE);
    await cache.put("/api/photos/a_thumb.webp", new Response(new Blob(["cached"])));

    await warmThumbnails([
      "/api/photos/a_thumb.webp", // already there
      "/api/photos/b_thumb.webp",
      "/api/photos/b_thumb.webp", // dup
      "/api/photos/c_thumb.webp",
    ]);

    expect(FakeCache.added.sort()).toEqual([
      "/api/photos/b_thumb.webp",
      "/api/photos/c_thumb.webp",
    ]);
  });

  it("is a no-op when Cache Storage is unavailable", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(warmThumbnails(["/api/photos/x_thumb.webp"])).resolves.toBeUndefined();
  });

  it("reports the cache size and count", async () => {
    await warmThumbnails(["/api/photos/a_thumb.webp", "/api/photos/b_thumb.webp"]);
    const stats = await thumbnailCacheStats();
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it("clears the whole cache", async () => {
    await warmThumbnails(["/api/photos/a_thumb.webp"]);
    expect(await fake.has(THUMB_CACHE)).toBe(true);
    await clearThumbnailCache();
    expect(await fake.has(THUMB_CACHE)).toBe(false);
    expect((await thumbnailCacheStats()).count).toBe(0);
  });
});
