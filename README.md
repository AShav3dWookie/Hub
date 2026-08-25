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

## Local development (without Docker)

Requires Node.js 22 LTS (better-sqlite3's native module does not currently build against newer Node majors).

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
