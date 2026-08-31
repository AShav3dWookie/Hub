# End-to-end / PWA tests

Playwright specs that drive the **production build** of the app in a mobile-emulated
Chromium (Pixel 7 — same engine as Chrome on Android, the PWA's target). Service workers are
off under `vite dev`, so these are the only automated check of install/offline/sync
behaviour.

## Running

```bash
npx playwright install chromium      # once — downloads the browser to the OS cache
npm run test:e2e                      # build → serve on :3100 → run
E2E_SKIP_BUILD=1 npm run test:e2e     # reuse the previous build (fast iteration)
npm run test:e2e:report               # open the HTML report of the last run
node e2e/serve.mjs                     # just stand the app up on :3100 for hands-on poking
```

`e2e/serve.mjs` builds everything, copies `client/dist` into `server/public`, wipes and
re-seeds a scratch SQLite DB at `e2e/.artifacts/e2e.db`, and starts `server/dist/index.js`
with auth disabled on `E2E_PORT` (default 3100). It never touches port 3000, `test-env/`, or
`data/`. Playwright starts it automatically (`webServer`) and, outside CI, reuses an
already-running instance.

## Layout

| File | Purpose |
|---|---|
| `serve.mjs` | build + seed + serve the app under test |
| `helpers/app.ts` | `gotoHome`, `serviceWorkerState`, `readStore` (IndexedDB), `offline()` |
| `smoke.spec.ts` | baseline — the shipped app still works |
| `*.spec.ts` (added per branch) | PWA shell, offline reads, image cache, settings, sync |

## Not covered here

Periodic Background Sync — Chrome gates it on a site-engagement heuristic that can't be
driven headlessly. `runSync({ reason: "periodic" })` is unit-tested directly instead; the
`periodicsync` registration is verified manually on a real device.

## Why not a dockerised Android emulator

It needs nested virtualisation (unreliable under Docker Desktop / WSL2 on Windows), adds
gigabytes and minutes-per-run, and the one thing a real device adds — actual background
sync — still can't be automated. Chromium here is the same Blink engine; Playwright's device
descriptor covers viewport, touch, DPR and UA. For a final real-device look, remote-debug a
physical phone over `chrome://inspect`.
