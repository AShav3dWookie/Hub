import { defineConfig } from "drizzle-kit";

// NOTE: paths are resolved relative to the process's cwd (repo root), since this
// config is always invoked via the root `npm run db:generate` script
// (`drizzle-kit generate --config server/drizzle.config.ts`), not from within
// `server/`. Do not use `import.meta.url`-based paths here — it breaks drizzle-kit's
// config loader.
export default defineConfig({
  schema: "./server/src/db/schema.ts",
  out: "./server/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH ?? "./server/data/logger.db",
  },
});
