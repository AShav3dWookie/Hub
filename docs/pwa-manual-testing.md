# Testing the PWA by hand

## The shape of it

`npm run pwa:up` starts four containers that mirror the home-server deployment,
with a **separate client machine** so you test a clean phone, not your dev browser:

```
your browser ─▶ http://localhost:3210 ─▶ client  (a real Chromium, in a container)
                                            │  talks over the container network to…
your browser ─▶ http://localhost:3200 ─┐    ▼
                                     nginx ─▶ app  (Express, internal :3000)
                                              ├─ /api/*            the backend
                                              └─ everything else   the built PWA
                                                 (HTML/JS/CSS + sw.js + manifest)
                                                 from server/public/
      seed  (one-shot: fills a fresh DB volume, then exits)
```

### Why there's no "client server"

In dev you run `dev:server` (API) *and* `dev:client` (Vite). **Neither exists in
production and neither can run the PWA** — `vite-plugin-pwa` disables the service
worker under `vite dev`. `npm run build` compiles the client to plain static files
that the **app container** serves. That's the entire backend.

The "client" is not a server — it's a **browser**. In production it's your phone; in
this stack it's the `client` container: a real Chromium (same Blink engine as
Chrome on Android) reaching the app as `http://nginx` over the container network,
exactly as a phone hits the home server. What makes a PWA a PWA — the service
worker, the caches, IndexedDB, the install — all lives in that browser.

### Two ways to test

| | Your own browser → `http://localhost:3200` | The client container → `http://localhost:3210` |
|---|---|---|
| Speed | instant | opens a Chromium desktop in a browser tab |
| State | **carries your real browser's history** — old service worker, half-full IndexedDB, a previous install | a clean, separate machine |
| Reset to a true first-run | clear site data by hand | `npm run pwa:client` — recreates the container: no SW, no IndexedDB, no install |
| Use it for | quick checks | **verifying how a fresh phone behaves after a server change** |

`http://localhost:3200` works for PWA features because `localhost` is a "secure
context". The client container reaches a non-localhost origin, so its Chromium runs
with `--unsafely-treat-insecure-origin-as-secure` (Chromium's built-in PWA-testing
switch) to let the service worker register there too.

## Run it

```bash
npm run pwa:up        # build + start everything
npm run pwa:down      # stop, keep the data
npm run pwa:reset     # stop + wipe the DB (next up re-seeds)
npm run pwa:client    # recreate ONLY the client → a brand-new browser
```

First `up` seeds sample data (movies, meals, people, a few photos) into a named
`pwa-data` volume; later runs keep whatever you've added. Everything is containers —
no local node servers.

Own compose project (`logger-pwa`) and ports (**3200** server, **3210** client), so
it never collides with your `:3000` instance, `:3100` (the automated e2e harness) or
`:5173` (Vite dev). The client image (`linuxserver/chromium`, ~1.5 GB) is pulled
once.

## What to try

Do this in the **client** at `http://localhost:3210` for a faithful test (or your
own browser at `:3200` for a quick one).

| Check | How |
|---|---|
| **Fresh install + first sync** | `npm run pwa:client`, open `:3210`. The app loads, registers its service worker, and syncs the seed data into IndexedDB — all on first visit. Install it: address-bar install icon → Install. |
| **Opens with the backend down** | `docker compose -f docker-compose.pwa.yml stop app`, then reload the client. Shell + all data still render. `start app` to restore. |
| **Offline browsing** | Client's DevTools → Network → **Offline**. Navigate, search, open entities, the calendar — all from IndexedDB. |
| **Reload while offline** | Offline + `Ctrl-R`. The service worker serves the cached shell. |
| **Gallery offline** | Open the Gallery once online, go offline, reload — thumbnails still paint. Open a photo → an "unavailable offline" placeholder (full-size originals aren't cached in this tier). |
| **Settings** | Bottom-bar gear → last-sync time, **Sync now**, thumbnail cache size + **Clear thumbnails**, background-sync status. |
| **Offline writes are blocked** | Offline → open an Add form → an "offline" banner appears and Save is disabled. Back online → it re-enables. |
| **Sync picks up server changes** | Change data via the API (`curl -X POST http://localhost:3200/api/logs ...` from your terminal), then hit **Sync now** in the client's Settings, or reopen the app. |
| **Cold client sees the change** | After a server change: `npm run pwa:client`, reopen `:3210` — the fresh browser syncs the new state from scratch. |

## Inspecting

Client's DevTools → **Application**:

- **Service Workers** — `sw.js` should be *activated*.
- **Cache Storage** — a `workbox-precache-*` bucket (the shell) and `logger-thumbs`.
- **IndexedDB → logger** — `entities` / `logs` / `photos` / `albums` / `entityNotes`
  mirror the server; `meta` holds `syncCursor` / `lastSyncAt` / `lastSyncError`.

## Notes

- The seed runs only when the volume has no `logger.db` — added data survives
  `pwa:down` / `pwa:up`. `pwa:reset` for a clean slate.
- Auth is disabled in this stack.
- Real-phone install still needs the HTTPS `hub.aaronhanna.uk` setup — separate WAN
  task, out of scope.
- `npm run test:e2e` is a *separate*, automated Playwright suite (its own throwaway
  server on :3100) — not for hands-on use.
