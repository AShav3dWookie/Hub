# Logger

A personal home-server webapp for manually logging movies, TV shows, restaurants, books, and games — with people (co-watchers, dining companions, etc.) as a first-class, linkable entity with their own profile page.

## Stack

- **Backend**: Node.js 22 + TypeScript + Express + better-sqlite3 + Drizzle ORM + Zod
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + React Router + TanStack Query
- **Database**: SQLite (single file, persisted via a Docker volume)
- **Monorepo**: npm workspaces (`shared`, `server`, `client`)

## Running with Docker (recommended)

### Compose
```bash
cp .env.example .env
# edit .env if you want to enable password auth (AUTH_ENABLED=true, etc.)
docker compose up --build
```

The app will be available at http://localhost:3000 (or `$PORT`). SQLite data persists in the `logger-data` named volume across restarts.

### Docker basic
```bash
docker build -t logger:local .
docker volume create logger-data
docker run -d \
  --name logger \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DB_PATH=/app/data/logger.db \
  -e AUTH_ENABLED=false \
  -e AUTH_PASSWORD_HASH= \
  -e SESSION_SECRET=password \
  -e COOKIE_SECURE=false \
  -v test-env:/app/data \
  --restart unless-stopped \
  logger:local
```

## Development — Dev Container (recommended)

The repo ships a VS Code **Dev Container** (`.devcontainer/`) with the whole toolchain baked
in — Node 22, ffmpeg, `sqlite3`, and a Playwright Chromium — so every machine is identical and
"X is not installed" can't happen.

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (WSL2
backend on Windows) + the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
VS Code extension.

1. Open the repo in VS Code → **"Reopen in Container"** (Command Palette, or the toast).
2. First build takes ~5–10 min (image + `npm ci`); later starts are seconds.
3. Then everything just works:

```bash
npm run dev:server     # http://localhost:3000  (forwarded)
npm run dev:client     # http://localhost:5173  (forwarded, proxies /api to :3000)
npm test               # backend + frontend
npm run test:e2e       # Playwright, using the baked Chromium
npm run lint
```

`node_modules` lives in a named volume (not the bind mount) for speed and to keep native
modules Linux-built. **`docker compose` / `npm run docker:*` / `npm run pwa:*` are run from a
host terminal**, not inside the container.

## Development — native (fallback)

Requires **Node.js 22 LTS exactly** (`better-sqlite3` / `sharp` native modules don't build on
newer majors — install `OpenJS.NodeJS.22` via winget or the 22.x MSI). For video poster
frames you also need `ffmpeg` on `PATH` (`winget install Gyan.FFmpeg`); without it uploads
still work but get a placeholder poster.

```bash
npm install
npm run db:generate   # only needed after changing server/src/db/schema.ts
npm run build --workspace shared
npm run dev:server     # http://localhost:3000
npm run dev:client     # http://localhost:5173 (proxies /api to :3000)
```

## Test data

To populate a database with a realistic set of sample entries for manual testing (movies, TV shows, restaurants, books, games, and tagged people with repeat visits/co-occurrences):

```bash
npm run seed:test-data
```

This writes a ready-to-use SQLite file to `test-env/logger.db` (gitignored). Point the app at it locally with `DB_PATH=./test-env/logger.db npm run dev:server`, or bind-mount it into a container instead of using the named volume:

```bash
docker build -t logger:local .
docker run -d \
  --name logger \
  -p 3000:3000 \
  -e DB_PATH=/app/data/logger.db \
  -v "$(pwd)/test-env:/app/data" \
  logger:local
```

Re-run `npm run seed:test-data` any time to reset back to a clean seeded state (it deletes and recreates `test-env/logger.db`).

## Tests

```bash
npm test              # backend + frontend unit/integration tests
npm run docker:test    # builds the image, runs it, and polls /api/health
```

## Environment variables

See [.env.example](.env.example) for the full list (`PORT`, `DB_PATH`, `AUTH_ENABLED`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`).
