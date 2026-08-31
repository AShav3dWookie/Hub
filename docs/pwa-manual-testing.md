# Testing the PWA by hand

A throwaway, fully isolated instance of the whole app (API + built PWA) for poking
at the offline behaviour yourself.

There is no separate "client" to run — Express serves both the API and the built
PWA bundle from `/public`. `docker-compose.pwa.yml` runs that single container with
its own project name, port and volume, so it never touches your `:3000` instance
or `test-env/`.

## Run it

```bash
npm run pwa:up        # build + start → http://localhost:3200  (first run seeds sample data)
npm run pwa:down      # stop, keep the DB
npm run pwa:reset     # stop and wipe the DB (next up re-seeds)
```

Open **http://localhost:3200** in Chrome. `localhost` is a secure context, so the
service worker registers and the app is installable there. (A real phone over plain
`http://<lan-ip>` is *not* a secure context — installing on a device needs the
HTTPS `hub.aaronhanna.uk` setup, which is still out of scope.)

## What to try

| Check | How |
|---|---|
| **Installs** | Address-bar install icon → Install. Launches in its own window. |
| **Opens with the server down** | `npm run pwa:down`, then open the installed app (or reload the tab). Shell + all data still render. `npm run pwa:up` to bring it back. |
| **Offline browsing** | DevTools → Network → Offline. Navigate, search, open entities, open the calendar — all served from IndexedDB. |
| **Reload while offline** | Offline + `Ctrl-R`. The service worker serves the cached shell. |
| **Gallery offline** | Open the Gallery once online (warms thumbnails), go offline, reload — thumbnails still paint. Open a photo → "unavailable offline" placeholder (full-size originals aren't cached in this tier). |
| **Settings** | Bottom-bar gear → last-sync time, **Sync now**, thumbnail cache size + **Clear thumbnails**, background-sync status. |
| **Offline writes are blocked** | Offline → open an Add form → an "offline" banner appears and Save is disabled. Back online → it re-enables. |
| **Sync picks up server changes** | Change something via the API (`curl -XPOST http://localhost:3200/api/logs ...`) or a second tab, then hit **Sync now** (or reopen the app). |

## Inspecting

DevTools → **Application**:

- **Service Workers** — should show `sw.js` *activated*.
- **Cache Storage** — `logger-thumbs` (thumbnails), `workbox-precache-*` (app shell).
- **IndexedDB → logger** — `entities` / `logs` / `photos` / `albums` / `entityNotes`
  mirror the server; `meta` holds `syncCursor` / `lastSyncAt` / `lastSyncError`.

## Notes

- The seed runs only when the volume has no `logger.db` yet — your added data
  survives `pwa:down` / `pwa:up`. Use `pwa:reset` for a clean slate.
- Auth is disabled in this stack.
- Port 3200 is chosen to avoid `:3000` (your instance), `:3100` (the e2e harness)
  and `:5173` (Vite dev).
