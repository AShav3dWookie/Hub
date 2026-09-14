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

// Push notifications. The server decides what to say and when (notificationScheduler); this only
// shows it. Every push must show a notification — browsers revoke push for sites that don't.
interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

self.addEventListener("push", (event) => {
  let message: PushMessage;
  try {
    message = event.data?.json() as PushMessage;
  } catch {
    message = { title: "Logger", body: event.data?.text() ?? "", url: "/", tag: "logger" };
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: { url: message.url ?? "/" },
    }),
  );
});

// Tapping a notification brings the app forward — reusing an open window if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? "/", self.location.origin)
    .href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows[0];
      if (existing) {
        await existing.focus();
        if (existing.url !== url) await existing.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// The browser replaced the subscription (keys rotated or expired) while the app may be closed.
// Hand the new one to the server so reminders keep arriving. Best-effort: if this fails — signed
// out, offline — the next app launch re-sends the subscription anyway (refreshPushSubscription).
interface PushSubscriptionChange extends ExtendableEvent {
  oldSubscription: PushSubscription | null;
  newSubscription: PushSubscription | null;
}

self.addEventListener("pushsubscriptionchange", (event) => {
  const e = event as PushSubscriptionChange;
  e.waitUntil(
    (async () => {
      const subscription =
        e.newSubscription ??
        (e.oldSubscription
          ? await self.registration.pushManager.subscribe(e.oldSubscription.options)
          : null);
      if (!subscription) return;
      await fetch("/api/notifications/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (e.oldSubscription && e.oldSubscription.endpoint !== subscription.endpoint) {
        await fetch("/api/notifications/subscriptions", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: e.oldSubscription.endpoint }),
        });
      }
    })().catch(() => undefined),
  );
});

// Daily Periodic Background Sync: pull the change-feed into the replica so an unopened,
// installed app still converges. Best-effort — a failed pull is recorded in meta.
self.addEventListener("periodicsync", (event) => {
  const e = event as PeriodicSyncEvent;
  if (e.tag === PERIODIC_SYNC_TAG) {
    e.waitUntil(pullChanges().catch(() => undefined));
  }
});
