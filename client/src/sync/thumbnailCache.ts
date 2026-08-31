/**
 * The thumbnail cache. Thumbnails are permanent offline data: the service worker serves them
 * CacheFirst from `THUMB_CACHE` and never expires them, and the sync engine warms the cache
 * with every new photo it learns about so the gallery works offline without anyone having
 * opened each image first.
 *
 * DOM-free where it matters — `sw.ts` imports `THUMB_CACHE` from here.
 */

export const THUMB_CACHE = "logger-thumbs";

const WARM_CHUNK = 8;

function hasCaches(): boolean {
  return typeof caches !== "undefined";
}

/** Fetch-and-store any thumbnails not already cached. Best-effort — failures are swallowed. */
export async function warmThumbnails(urls: string[]): Promise<void> {
  if (!hasCaches() || urls.length === 0) return;
  const cache = await caches.open(THUMB_CACHE);
  const unique = [...new Set(urls)];

  for (let i = 0; i < unique.length; i += WARM_CHUNK) {
    const chunk = unique.slice(i, i + WARM_CHUNK);
    await Promise.allSettled(
      chunk.map(async (url) => {
        if (await cache.match(url)) return;
        await cache.add(url);
      }),
    );
  }
}

export interface CacheStats {
  count: number;
  bytes: number;
}

/** Size of the thumbnail cache, computed by walking the Cache Storage entries. */
export async function thumbnailCacheStats(): Promise<CacheStats> {
  if (!hasCaches()) return { count: 0, bytes: 0 };
  const cache = await caches.open(THUMB_CACHE);
  const keys = await cache.keys();
  let bytes = 0;
  for (const request of keys) {
    const res = await cache.match(request);
    if (res) bytes += (await res.clone().blob()).size;
  }
  return { count: keys.length, bytes };
}

/** Drop every cached thumbnail. They re-download (and re-warm on next sync) as needed. */
export async function clearThumbnailCache(): Promise<void> {
  if (!hasCaches()) return;
  await caches.delete(THUMB_CACHE);
}
