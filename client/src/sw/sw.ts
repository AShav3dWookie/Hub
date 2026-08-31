/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst, NetworkOnly } from "workbox-strategies";

/**
 * The Logger service worker (injectManifest). Precaches the built app shell so the app opens
 * with zero network, routes navigations to the cached `index.html`, and keeps `/api` on the
 * network — the sync engine owns offline data. The thumbnail / original image caches are
 * added in the next branches.
 */

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

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

// Auth status: prefer fresh, fall back to the last good response (the app also keeps its own
// copy in IndexedDB — this just avoids a hang on a slow network).
registerRoute(
  ({ url }) => url.pathname === "/api/auth/status",
  new NetworkFirst({ cacheName: "logger-auth", networkTimeoutSeconds: 3 }),
);

// Everything else under /api (mutations, photos for now) is online-only.
registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());
