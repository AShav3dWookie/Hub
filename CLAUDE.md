# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Logger" — a personal home-server webapp for manually logging movies, TV, restaurants, books and
games, with tagged people (co-watchers, dining companions) as first-class linkable entities. npm
workspaces monorepo: `shared` (types), `server` (Express API + SPA host), `client` (React SPA).

## Environment

- **Development happens inside the dev container** (`.devcontainer/`) — Node 22, `ffmpeg`,
  `sqlite3`, and a Playwright Chromium are baked in, so nothing is "not installed" and the host
  Node version is irrelevant. Open the repo in VS Code → "Reopen in Container". `node_modules`
  is a named volume; `npm ci` runs on create.
- **`docker compose` / `npm run docker:*` / `npm run pwa:*` run from a HOST terminal**, not
  inside the container — the compose files bind-mount `./test-env` and `./docker/*`, which a
  host daemon can't resolve to a container path.
- `.mcp.json` pins `@playwright/mcp` (a root devDependency); the browser is baked into the
  image, so there's no per-machine `install-browser` step.

### Native (no container) fallback

- **Node.js 22 exactly.** `better-sqlite3` / `sharp` native modules don't build on newer
  majors, and `OpenJS.NodeJS.LTS` is currently 24 — install `OpenJS.NodeJS.22` (winget) or the
  22.x MSI. For video poster frames, also `winget install Gyan.FFmpeg` (else uploads get a
  placeholder poster).
- `npm install` at the repo root installs all workspaces (prebuilt better-sqlite3 binary).
- `npm run db:migrate --workspace server` is **broken on Windows** (its
  `import.meta.url === process.argv[1]` self-run guard never matches backslash paths). It works
  fine in the dev container. Tests and Docker apply migrations regardless — they call
  `runMigrations()` directly.

## Commands

```bash
npm run build --workspace shared   # MUST run before server/client will typecheck (they import @logger/shared/dist)
npm run build                      # shared -> server -> client
npm test                           # shared + server + client + parity (builds shared first)
npm run test:coverage              # all three workspaces, v8, with enforced thresholds
npm run lint                       # eslint (flat config at repo root) per workspace
npm run typecheck:parity           # the parity suite is not in a workspace, so tsc it separately

npm run db:generate                # regenerate migrations after editing server/src/db/schema.ts (ROOT script only)
npm run seed:test-data             # writes a realistic sample DB to test-env/logger.db

npm run dev:server                 # API on :3000
npm run dev:client                 # Vite on :5173, proxies /api -> :3000
docker compose up --build          # full app on :3000 (SQLite persisted in a volume)
```

Run a single test file: `cd server && npx vitest run <path-substring>` (or `cd client && ...`, or
`npx vitest run --root parity`).

- `eslint` and its plugins live only in the **root** `package.json`; each workspace's `lint` script is
  `eslint src` and resolves the config upward.
- `npm run db:migrate` — see the "Native (no container) fallback" note above.
- `npm test` builds `shared` first via a `pretest` hook. Without it a stale `shared/dist` makes the
  server suite fail at runtime with something unhelpful like "mediaKindForMime is not a function".

## Architecture

### Data model (`server/src/db/schema.ts`)

- **`entities`** — one row per unique `(category, normalizedTitle)`. Categories: movie, tv, eating_out,
  book, game, hang_out, appointment, **person**. People are just entities; they have no logs of their
  own and are tagged onto other logs. Dedup is by `normalizeTitle()` (`shared/src/normalize.ts`:
  lowercase + collapse whitespace).
- **`logs`** — a dated entry against an entity (`rating`, `date`, `notes`). `entityId` cascades.
- **`log_people`** — join table; which person-entities are tagged on a log.
- **`entity_notes`** — freeform notes on any entity. The `important_date` category (with `tag` +
  `eventDate`) powers the home-screen "upcoming dates" widget (`importantDatesService`, annual
  month/day recurrence).
- **`log_photos`** — photo attachments. `logId` is **nullable with `ON DELETE SET NULL`**: deleting a
  log keeps its photos as "gallery orphans" by default (`?deletePhotos=true` on the delete removes
  them + files).

### Category configuration is the single source of truth

`shared/src/categories.ts` → `CATEGORY_FIELDS` declares, per loggable category, which fields apply
(`hasPeople`, `hasReleaseYear`, `hasAuthor`, `hasRating`, `hasAutoDelete`, `dateGranularity`,
`dateLabel`). Both the client add forms and server services branch on this. `hasPeople` is true for
**movie**, **eating_out** and **hang_out**, and also gates photo support via
`categorySupportsPhotos()` — enforced server-side in `logPhotosService.assertLogSupportsPhotos`, not
just hidden in the UI. `categories.test.ts` asserts every category has a config and metadata entry,
so adding one without wiring it up fails the suite.

### Shared business rules

`shared/src/rules/*` holds every filtering, ordering, windowing and paging decision the app makes:
search, calendar placement, the home-screen today/next-7-days split, gallery cursor paging and
person stats. `shared/src/dates.ts` holds the UTC date maths.

This exists because the app has **two implementations of every read** — the server over SQL and the
offline client over its snapshot. They cannot share data access, so they share the rules instead.
Neither side should re-implement a comparator, a filter or a date calculation locally; if one is
missing, add it here so both get it.

Two deliberate asymmetries, both covered by tests: `nextAnnualOccurrence` rolls a Feb 29 date to
Mar 1 in a non-leap year, while calendar range placement *skips* a day that does not exist. And every
sort ends with an id tie-break, because tied rows otherwise come back in whatever order the storage
produced, which differs between the two sides.

### `shared` is a build dependency

`@logger/shared` resolves to `shared/dist`, not `shared/src`. After editing `shared/src/*`, rebuild it
(`npm run build --workspace shared`) or server/client typechecks will use stale types. Server tsconfig
has a project reference to it.

### DTO construction / the N+1 rule

`logService.toLogDTO(row, people, photos, albumRefs)` and `toLogWithEntity` are the **only** places a
`LogDTO` is built. Both default `photos` and `albumRefs` to `[]`, so a list or summary view calls them
with just `(row, people)` and never triggers a per-log photo lookup. Only the entity-detail log list
and the dedicated `/api/gallery` endpoint pass real photos.

Do not hand-build a `LogDTO`. `searchService` and `entityDetailService.getPersonProfile` used to, and
it meant every new field had to be added in three places.

### Server layering

`routes/*` are thin: `schema.parse(req.body)` (Zod, in `lib/validation.ts`) → call a service → set a
status code. Path params go through `idParam(req, name, label)` from `lib/params.ts` — don't write the
`Number()` + `Number.isInteger` guard inline, which used to appear thirteen times in three different
forms. `services/*` hold all logic and take `db: AppDb` as the first argument (plus `photosDir` for
photo/gallery services — passed explicitly for testability, never imported from config).
`middleware/errorHandler` maps `ZodError` → 400 `{error, details}`, `AppError` subclasses
(`NotFoundError` 404 / `BadRequestError` 400) → their status, anything else → 500. The upload pipeline
(multer config, the `Content-Length` pre-check, multer error translation) is `middleware/upload.ts`.

`app.ts` `createApp(db, photosDir?)` mounts: `/api/health` + `/api/auth` (open) → the rest of `/api/*`
behind `requireAuth` → `express.static` for `/api/photos/<file>` → the built SPA from `public/` with a
catch-all that excludes `/api`. `errorHandler` is last.

### Auth

`cookie-session` + `AUTH_ENABLED` env toggle (default off, LAN use). `requireAuth` is a pass-through
when disabled. **`config.ts` reads `process.env` at module load**, so tests that flip `AUTH_ENABLED`
must `vi.resetModules()` and dynamically `import` `app.js` (see `app.test.ts`).

`assertSecureConfig()` runs from the entrypoint (not at module load, so tests can build the app
freely) and refuses to start when auth is on but `SESSION_SECRET` is still the built-in development
value — that constant is in this repository, so signing real sessions with it would let anyone forge
a logged-in cookie. It also refuses auth-on with no `AUTH_PASSWORD_HASH`, which previously failed
every login with a 500 at request time instead of at boot.

### Photos & video storage

`config.photosDir` derives from `path.dirname(config.dbPath) + "/photos"` so it shares the DB's
persistent volume with no extra mount. `logPhotosService` stores originals under `crypto.randomUUID()`
filenames plus a `sharp`-generated webp thumbnail (falls back to serving the original if `sharp` can't
decode the format, e.g. HEIC without libheif). multer uses `memoryStorage`.

Videos are supported alongside photos and appear inline with them in every view. **mp4 only**
(`video/mp4`) — the file is played back as-is (no transcoding) and mp4/H.264 is the only format that
plays everywhere; `.mov` / `.webm` are rejected at upload. The `<uuid>_thumb.webp` slot holds a
**poster frame** decoded by `ffmpeg` (`server/src/lib/videoPoster.ts`: `ffmpeg` → one PNG on stdout →
the same sharp recipe). If `ffmpeg` is missing or can't decode, a generated placeholder tile is
written instead — the thumbnail is always a real webp, so the SW offline cache and `<img>` grids keep
working. `LogPhotoDTO.kind` (`"photo" | "video"`) is derived from the stored MIME type on both ends;
no DB column was added.

- **ffmpeg is a runtime dependency.** The Docker image installs it (`apk add ffmpeg`). Local dev
  without it still works — uploads succeed with a placeholder poster. Override the binary with
  `FFMPEG_PATH`.
- The single MIME allow-list + size caps live in `shared/src/media.ts` (`MEDIA_ACCEPT_ATTR`,
  `mediaKindForMime`, `maxBytesForMime`) — imported by both the client forms and the server pipeline.
- Limits (enforced server-side): 10 photos-or-videos/log, 100/album; 10 MB/photo, 250 MB/video;
  per upload request ≤ 10 videos and ≤ ~900 MB combined (`rejectOversizeUpload` middleware pre-checks
  `Content-Length` before multer buffers, since `memoryStorage` holds the whole request in RAM).
- A photo/video filter is intentionally not implemented yet.

### Database (SQLite / better-sqlite3)

`db/client.ts` `createDb()` opens the DB in **WAL** journal mode. A fresh DB on a filesystem that
can't do WAL silently uses the rollback journal instead; but if there's an existing/contended
`-wal`, the WAL pragma throws `SQLITE_IOERR_SHMOPEN` and `createDb` rethrows it as a plain-English
error naming the likely cause.

**Only one process may hold `test-env/logger.db` at a time.** The local `docker-compose.yml`
bind-mounts `./test-env` into the container by design (the user's own testing DB). WAL's shared-memory
`-shm` file can't be coordinated between a Windows `better-sqlite3` process and the Linux container
over the Docker Desktop mount, so if anything else has that file open when `docker compose up` runs —
a `npm run dev:server`, or a stray leftover `node dist/index.js` from an earlier test — the container
crash-loops on `SQLITE_IOERR_SHMOPEN`. Stop every other process on that DB before starting the
container, and always kill background `node dist/index.js` / `docker` processes after testing.

### Migrations

`server/drizzle/*.sql` + `meta/` snapshots, generated by `npm run db:generate` (drizzle-kit, run from
repo root — paths in `drizzle.config.ts` are relative to root cwd). Applied by `runMigrations(dbPath)`
in `db/migrate.ts`, called at server startup and by `createTestDb()`. SQLite cannot alter a column's
nullability or a foreign key, so changing an existing column produces a `__new_<table>` recreate
migration (`CREATE __new_` → `INSERT…SELECT` → `DROP` → `RENAME` → re-`CREATE INDEX`). There is a
regression test for this in `server/src/db/migrate.test.ts`.

### Client

React Router v7 with nested `<Routes>` in `App.tsx` — every real route is wrapped in `ProtectedRoute`
+ `Layout` + `BottomNav`. TanStack Query v5; all hooks in `api/hooks.ts`. `api/client.ts`: `request()`
always sends `Content-Type: application/json` + `credentials: "include"`; `postForm()` omits the
content-type for multipart `FormData` uploads. Query keys in use: `["entity", id]`,
`["search", query]`, `["entity-notes", id]`, `["gallery"]` (a `useInfiniteQuery`, id-cursor paging),
`["auth-status"]`. Forms are hand-rolled `useState` — no form library.

Every write hook goes through `useRefreshingMutation`, which queues the outbox envelope and then
invalidates and syncs. Add a write by writing that one expression, not the five-line wiring.

Tailwind with `dark:` variants throughout; icons from `lucide-react`. The repeated class strings live
in `components/ui.tsx` (`FIELD_CLASS`, `CARD_CLASS`, the button shapes) — use them rather than pasting
the string again. Reusable components: `Lightbox` (full-screen image + caption slot), `PhotoGallery`
(per-log grid + upload), `PhotoStream` (paged gallery grid), `PeopleTagInput`, `PersonLinks`
(the "with Ada, Zoe" line), `MediaThumb` (thumbnail + video badge), `SearchResults`, `AlbumSections`.

**Media is online-only.** It has no offline queue, and a record created offline holds a temporary
negative id the photo routes reject. The add forms call `sync/resolveServerId.ts`, which flushes the
outbox and returns the real id, and disable the picker when offline rather than accepting files they
would drop. Do not attach media to an unresolved id.

### Tests

Vitest, in four suites. **shared** (`environment: node`): pure unit tests of the rules. **Server**
(`environment: node`): a real temp SQLite file per test via `createTestDb()` — no DB mocks; migrations
run for real. Route tests use `supertest` against `createApp()`, with a `fs.mkdtempSync` temp
`photosDir`. **Client** (`environment: jsdom`): `renderWithProviders()` wraps in QueryClient +
MemoryRouter + ToastProvider; the global `fetch` is stubbed with `vi.fn()` (no MSW). Test files are
colocated as `*.test.ts(x)`.

**parity/** is the fourth, and spans both workspaces at once. It seeds a real database, drains the
server's own change-feed into `buildSnapshot`, then asserts the server service and the offline client
query return identical output for every read path. It lives outside both workspaces because it
imports from both, with its own vitest config and `npm run typecheck:parity`. When you change a read
on either side, this is what proves the other still agrees — it found two real tie-break bugs on its
first run.

All three workspaces enforce coverage thresholds set just below what they currently reach, so a
regression fails `npm run test:coverage`.

**Two rules learned the hard way.** Write tests against user-visible outcomes, not transport: a test
naming a URL and a body type cannot survive a change of mechanism and gets deleted instead of
translated. And when refactoring, diff the test titles against your branch point and account for
every removal by name — a capability once lost its only test that way, and the code it protected was
removed a commit later with nothing left to fail:

```bash
git diff <branch-point>...HEAD -- '*.test.ts' '*.test.tsx' | grep "^-.*\bit("
```

### Visual verification

`.mcp.json` registers the **Playwright MCP** server (`@playwright/mcp`, headless + isolated). Use it to
drive the real running app for UI changes — start `npm run dev:server` + `npm run dev:client`, then
navigate to `http://localhost:5173`, screenshot, and check layout/responsive/dark-mode. jsdom tests
don't render CSS, so this is the only way to actually *see* a change.

- `.mcp.json` is read only at Claude Code startup — a session started before it existed won't have the
  `browser_*` tools until it's restarted (and the project MCP server is approved on first load).
- In the dev container the Chromium is **baked into the image** (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`)
  — no `install-browser` step, no `cmd /c` shim. Native-Windows fallback: first use may need
  `npx @playwright/mcp install-browser chromium` (~115 MB into the OS Playwright cache).
- Screenshots/snapshots land in `.playwright-mcp/` (gitignored).
- **On the host, `:3000` is usually the user's own `docker compose` instance (`hub-app-1`, image
  `logger:local`) — do not stop it.** Inside the dev container `:3000` is free for `npm run dev:server`
  (VS Code auto-remaps the forward if the host's `:3000` is taken).
- For a throwaway live check without disturbing anything on `:3000`: build the client,
  `cp client/dist/* server/public/`, run `DB_PATH=<scratchpad>/x.db PORT=3001 node --import tsx src/index.ts`,
  drive Playwright at `:3001`, then kill it and remove `server/public/` + the scratch DB.

## Git workflow

**Every feature is developed on its own branch — never commit feature work directly to `main`.**

1. `git checkout -b <feature-name>` off `main`.
2. Commit the work on that branch.
3. `git push -u origin <feature-name>` — **the branch must be pushed to `origin`** (the user wants
   feature branches visible on GitHub, not local-only).
4. `git checkout main && git merge --no-ff <feature-name>` — always `--no-ff` so the branch shows as
   a "Merge branch '<feature-name>'" commit in history. Then `git push origin main`.
5. Delete the local branch (`git branch -d`). Ask before deleting the remote branch.

No pull requests — merge locally and push. Follow-up work (e.g. "add more tests for X") gets its own
branch too.

## Repo notes

- `test-env/` and `data/` are gitignored scratch dirs (seeded DBs, local Docker mounts).
- `docker-compose.yml` may carry a local bind-mount edit (`./test-env:/app/data`) — an environment
  preference, not usually committed.
- `photos-plan.txt` and `Future_features.md` at the root are feature design notes.
