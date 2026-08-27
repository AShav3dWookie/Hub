# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Logger" — a personal home-server webapp for manually logging movies, TV, restaurants, books and
games, with tagged people (co-watchers, dining companions) as first-class linkable entities. npm
workspaces monorepo: `shared` (types), `server` (Express API + SPA host), `client` (React SPA).

## Environment

- **Node.js 22 is required.** `better-sqlite3`'s native module does not build on newer majors, and
  `OpenJS.NodeJS.LTS` is currently 24 — install `OpenJS.NodeJS.22` (winget) or the 22.x MSI.
- `npm install` at the repo root installs all workspaces (uses a prebuilt better-sqlite3 binary).

## Commands

```bash
npm run build --workspace shared   # MUST run before server/client will typecheck (they import @logger/shared/dist)
npm run build                      # shared -> server -> client
npm test                           # server vitest + client vitest
npm run test:coverage              # both workspaces, v8 coverage report
npm run lint                       # eslint (flat config at repo root) per workspace

npm run db:generate                # regenerate migrations after editing server/src/db/schema.ts (ROOT script only)
npm run seed:test-data             # writes a realistic sample DB to test-env/logger.db

npm run dev:server                 # API on :3000
npm run dev:client                 # Vite on :5173, proxies /api -> :3000
docker compose up --build          # full app on :3000 (SQLite persisted in a volume)
```

Run a single test file: `cd server && npx vitest run <path-substring>` (or `cd client && npx vitest run <substring>`).

- `npm run db:migrate --workspace server` is **broken on Windows** (its `import.meta.url === process.argv[1]`
  self-run guard never matches backslash paths). Tests and Docker apply migrations fine — they call
  `runMigrations()` directly.
- `eslint` and its plugins live only in the **root** `package.json`; each workspace's `lint` script is
  `eslint src` and resolves the config upward.

## Architecture

### Data model (`server/src/db/schema.ts`)

- **`entities`** — one row per unique `(category, normalizedTitle)`. Categories: movie, tv, eating_out,
  book, game, **person**. People are just entities; they have no logs of their own and are tagged onto
  other logs. Dedup is by `normalizeTitle()` (`lib/normalize.ts`: lowercase + collapse whitespace).
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
(`hasPeople`, `hasReleaseYear`, `hasAuthor`, `dateGranularity: "day" | "year"`). Both the client add
forms and server services branch on this. `hasPeople` is true only for **movie** and **eating_out**,
and also gates photo support via `categorySupportsPhotos()` — enforced server-side in
`logPhotosService.assertLogSupportsPhotos`, not just hidden in the UI.

### `shared` is a build dependency

`@logger/shared` resolves to `shared/dist`, not `shared/src`. After editing `shared/src/*`, rebuild it
(`npm run build --workspace shared`) or server/client typechecks will use stale types. Server tsconfig
has a project reference to it.

### DTO construction / the N+1 rule

`logService.toLogDTO(row, people, photos)` is the one real place a `LogDTO` is built — used by
`getLogsForEntity` / `getLogById`, which join in real photos. `searchService` (two sites) and
`entityDetailService.getPersonProfile` build `LogDTO` / `LogWithEntityDTO` **by hand with
`photos: []`** — deliberate, so list/summary/search views never trigger per-log photo lookups. Only
the entity-detail log list and the dedicated `/api/gallery` endpoint return real photos.

### Server layering

`routes/*` are thin: `schema.parse(req.body)` (Zod, in `lib/validation.ts`) → call a service → set a
status code. Path params are validated inline with `Number()` + `Number.isInteger` throwing
`BadRequestError`. `services/*` hold all logic and take `db: AppDb` as the first argument (plus
`photosDir` for photo/gallery services — passed explicitly for testability, never imported from
config). `middleware/errorHandler` maps `ZodError` → 400 `{error, details}`, `AppError` subclasses
(`NotFoundError` 404 / `BadRequestError` 400) → their status, anything else → 500.

`app.ts` `createApp(db, photosDir?)` mounts: `/api/health` + `/api/auth` (open) → the rest of `/api/*`
behind `requireAuth` → `express.static` for `/api/photos/<file>` → the built SPA from `public/` with a
catch-all that excludes `/api`. `errorHandler` is last.

### Auth

`cookie-session` + `AUTH_ENABLED` env toggle (default off, LAN use). `requireAuth` is a pass-through
when disabled. **`config.ts` reads `process.env` at module load**, so tests that flip `AUTH_ENABLED`
must `vi.resetModules()` and dynamically `import` `app.js` (see `app.test.ts`).

### Photos storage

`config.photosDir` derives from `path.dirname(config.dbPath) + "/photos"` so it shares the DB's
persistent volume with no extra mount. `logPhotosService` stores originals under `crypto.randomUUID()`
filenames plus a `sharp`-generated webp thumbnail (falls back to serving the original if `sharp` can't
decode the format, e.g. HEIC without libheif). multer uses `memoryStorage`. Limits (enforced
server-side): 10 photos/log, 10 MB/file, jpeg/png/webp/heic.

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
`["auth-status"]`. Forms are hand-rolled `useState` — no form library. Tailwind with `dark:` variants
throughout; icons from `lucide-react`. Reusable: `Lightbox` (full-screen image + caption slot),
`PhotoGallery` (per-log grid + upload), `PeopleTagInput`.

### Tests

Vitest. **Server** (`environment: node`): a real temp SQLite file per test via `createTestDb()` — no
DB mocks; migrations run for real. Route tests use `supertest` against `createApp()`, with a
`fs.mkdtempSync` temp `photosDir`. **Client** (`environment: jsdom`): `renderWithProviders()` wraps in
QueryClient + MemoryRouter + ToastProvider; the global `fetch` is stubbed with `vi.fn()` (no MSW).
Test files are colocated as `*.test.ts(x)`.

### Visual verification

`.mcp.json` registers the **Playwright MCP** server (`@playwright/mcp`, headless + isolated). Use it to
drive the real running app for UI changes — start `npm run dev:server` + `npm run dev:client`, then
navigate to `http://localhost:5173`, screenshot, and check layout/responsive/dark-mode. jsdom tests
don't render CSS, so this is the only way to actually *see* a change.

## Repo notes

- `test-env/` and `data/` are gitignored scratch dirs (seeded DBs, local Docker mounts).
- `docker-compose.yml` may carry a local bind-mount edit (`./test-env:/app/data`) — an environment
  preference, not usually committed.
- `photos-plan.txt` and `Future_features.md` at the root are feature design notes.
