/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, NetworkOnly } from "workbox-strategies";
import { THUMB_CACHE } from "../sync/thumbnailCache.js";
import { pullChanges } from "../sync/pull.js";
import { PERIODIC_SYNC_TAG } from "./periodicSync.js";

/**
 * The Logger service worker (injectManifest). Precaches the built app shell so the app opens
 * with zero network, routes navigations to the cached `index.html`, keeps `/api` on the
 * network (the sync engine owns offline data), caches thumbnails permanently, and runs the
 * change-feed pull on the daily Periodic Background Sync.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string;
}

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigations → the precached shell. `/api` is excluded so API 404s/HTML errors don't
// get swallowed by the shell.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//],
  }),
);

// The sync engine handles offline for the change-feed itself.
registerRoute(({ url }) => url.pathname.startsWith("/api/sync/"), new NetworkOnly());

// Thumbnails (and video poster frames — also `_thumb.webp`): permanent offline data.
// Cache on first fetch, keep forever (no expiration). The video/photo originals themselves
// fall through to the NetworkOnly catch-all below.
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/photos/") && url.pathname.endsWith("_thumb.webp"),
  new CacheFirst({ cacheName: THUMB_CACHE }),
);

// Auth status: prefer fresh, fall back to the last good response (the app also keeps its own
// copy in IndexedDB — this just avoids a hang on a slow network).
registerRoute(
  ({ url }) => url.pathname === "/api/auth/status",
  new NetworkFirst({ cacheName: "logger-auth", networkTimeoutSeconds: 3 }),
);

// Everything else under /api (mutations, photos for now) is online-only.
registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());

// Daily Periodic Background Sync: pull the change-feed into the replica so an unopened,
// installed app still converges. Best-effort — a failed pull is recorded in meta.
self.addEventListener("periodicsync", (event) => {
  const e = event as PeriodicSyncEvent;
  if (e.tag === PERIODIC_SYNC_TAG) {
    e.waitUntil(pullChanges().catch(() => undefined));
  }
});
