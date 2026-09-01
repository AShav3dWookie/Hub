# Testing the PWA by hand

## First: why there's no "client server"

In development you run two servers — `dev:server` (the API on :3000) and `dev:client`
(Vite on :5173, hot-reload + a proxy to the API). **Neither of those exists in
production, and the PWA cannot be tested with them** (`vite-plugin-pwa` disables the
service worker under `vite dev`).

In production the client is not a server at all. `npm run build` compiles the React
app to plain static files — HTML, JS, CSS, `sw.js`, `manifest.webmanifest`, icons —
and the **app container** (Express) serves them:

```
browser ──▶ nginx (:3200) ──▶ app container (Express, :3000)
                               ├─ /api/*             the backend
                               └─ everything else    the built PWA bundle
                                                     from  server/public/
```

That's the whole backend. The "client", in PWA terms, is what runs **in the
browser**: the installed app window, its **service worker** (caches the shell,
serves it offline), and **IndexedDB** (the local data replica). None of that lives
in a container — it's the browser's job, and it only appears when a real build is
served from a real origin.

So this compose stack **is** production reality — the same single app container
you already run with `docker compose up`, now behind an nginx reverse proxy to
match the eventual `hub.aaronhanna.uk` topology (Cloudflare → nginx → app).
Testing against it exercises exactly what ships.

> TLS: Cloudflare terminates HTTPS in production. Locally, `http://localhost:3200`
> is already a "secure context", so the service worker registers and the app is
> installable on your desktop. Installing on a **real phone** needs the actual
> HTTPS domain — that's the separate WAN task, still out of scope.

## Run it

```bash
npm run pwa:up        # build + start   → http://localhost:3200
npm run pwa:down      # stop, keep whatever data you've added
npm run pwa:reset     # stop + wipe the DB (next up re-seeds)
```

First `up` seeds sample data (movies, meals, people, a few photos). Later runs keep
your changes. Everything runs in containers — no local node servers.

Its own compose project (`logger-pwa`), port **3200**, and a named `pwa-data`
volume, so it never collides with your `:3000` instance, `:3100` (the automated e2e
harness) or `:5173` (Vite dev).

## What to try — all against http://localhost:3200

| Check | How |
|---|---|
| **Installs as an app** | Chrome address-bar install icon → Install. Opens in its own window. |
| **Opens with the backend down** | `npm run pwa:down`, then open the installed app (or reload the tab). Shell + all data still render from the service worker + IndexedDB. `npm run pwa:up` to bring it back. |
| **Offline browsing** | DevTools → Network → **Offline**. Navigate, search, open entities, the calendar — all from IndexedDB, no requests. |
| **Reload while offline** | Offline + `Ctrl-R`. The service worker serves the cached shell. |
| **Gallery offline** | Open the Gallery once online (warms the thumbnail cache), go offline, reload — thumbnails still paint. Open a photo → an "unavailable offline" placeholder (full-size originals aren't cached in this tier). |
| **Settings** | Bottom-bar gear → last-sync time, **Sync now**, thumbnail cache size + **Clear thumbnails**, background-sync status. |
| **Offline writes are blocked** | Offline → open an Add form → an "offline" banner appears and Save is disabled. Back online → it re-enables. |
| **Sync picks up server changes** | While it's running, change something through the API (a second browser tab, or `curl -X POST http://localhost:3200/api/logs ...`), then hit **Sync now** in Settings, or just reopen the app. |

## Inspecting

DevTools → **Application**:

- **Service Workers** — `sw.js` should be *activated*.
- **Cache Storage** — `workbox-precache-*` (the app shell), `logger-thumbs` (thumbnails).
- **IndexedDB → logger** — `entities` / `logs` / `photos` / `albums` / `entityNotes`
  mirror the server; `meta` holds `syncCursor` / `lastSyncAt` / `lastSyncError`.

## Notes

- The seed runs only when the volume has no `logger.db` — your added data survives
  `pwa:down` / `pwa:up`. Use `pwa:reset` for a clean slate.
- Auth is disabled in this stack.
- `npm run test:e2e` is a *separate*, automated Playwright suite — it stands up its
  own throwaway server on :3100 for speed and isolation, and isn't meant for
  hands-on use. For that, always use `npm run pwa:up`.
