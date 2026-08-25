import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runMigrations(dbPath: string) {
  const db = createDb(dbPath);
  migrate(db, { migrationsFolder: path.join(__dirname, "..", "..", "drizzle") });
  return db;
}

// Allow running directly: `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.DB_PATH ?? "./data/logger.db";
  runMigrations(dbPath);
  // eslint-disable-next-line no-console
  console.log(`Migrations applied to ${dbPath}`);
}
