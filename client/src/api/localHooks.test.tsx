import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const forceSync = vi.hoisted(() => vi.fn());
const nextScheduledSyncAt = vi.hoisted(() => vi.fn());
vi.mock("../sync/engine.js", () => ({ forceSync, nextScheduledSyncAt, runSync: vi.fn() }));

import {
  useOnlineStatus,
  useSyncStatus,
  useForceSync,
  useThumbnailCacheStats,
  useClearThumbnailCache,
} from "./localHooks.js";
import { setMeta, META_LAST_SYNC_AT, META_LAST_SYNC_ERROR } from "../local/db.js";
import { warmThumbnails, THUMB_CACHE } from "../sync/thumbnailCache.js";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// ---- fake Cache Storage (see thumbnailCache.test.ts) ----
class FakeCache {
  store = new Map<string, Response>();
  private k(r: unknown) {
    return typeof r === "string" ? r : String((r as { url: unknown }).url);
  }
  async match(r: unknown) {
    return this.store.get(this.k(r));
  }
  async add(r: unknown) {
    this.store.set(this.k(r), new Response(new Blob(["xxxx"])));
  }
  async put(r: unknown, res: Response) {
    this.store.set(this.k(r), res);
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
  async delete(r: unknown) {
    return this.store.delete(this.k(r));
  }
}
class FakeCaches {
  m = new Map<string, FakeCache>();
  async open(n: string) {
    if (!this.m.has(n)) this.m.set(n, new FakeCache());
    return this.m.get(n)!;
  }
  async delete(n: string) {
    return this.m.delete(n);
  }
}

describe("localHooks", () => {
  beforeEach(() => {
    forceSync.mockReset().mockResolvedValue({ pages: 1, rows: 0, cursor: "1" });
    nextScheduledSyncAt.mockReset().mockResolvedValue(null);
    vi.stubGlobal("caches", new FakeCaches());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("useOnlineStatus tracks online/offline events", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    spy.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    await waitFor(() => expect(result.current).toBe(false));
    spy.mockRestore();
  });

  it("useSyncStatus reads the recorded meta", async () => {
    await setMeta(META_LAST_SYNC_AT, 1_700_000_000_000);
    await setMeta(META_LAST_SYNC_ERROR, "network");
    const { result } = renderHook(() => useSyncStatus(), { wrapper: wrapper() });
    await waitFor(() =>
      expect(result.current.data).toEqual({
        lastSyncAt: 1_700_000_000_000,
        lastError: "network",
        nextScheduledAt: null,
      }),
    );
  });

  it("useForceSync calls the engine", async () => {
    const { result } = renderHook(() => useForceSync(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(forceSync).toHaveBeenCalledOnce();
  });

  it("useThumbnailCacheStats / useClearThumbnailCache reflect the cache", async () => {
    await warmThumbnails(["/api/photos/a_thumb.webp", "/api/photos/b_thumb.webp"]);

    const w = wrapper();
    const stats = renderHook(() => useThumbnailCacheStats(), { wrapper: w });
    await waitFor(() => expect(stats.result.current.data?.count).toBe(2));

    const clear = renderHook(() => useClearThumbnailCache(), { wrapper: w });
    await act(async () => {
      await clear.result.current.mutateAsync();
    });
    const cs = await (await (globalThis.caches as unknown as FakeCaches).open(THUMB_CACHE)).keys();
    expect(cs).toHaveLength(0);
  });
});
