import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../db/migrate.js";
import type { AppDb } from "../db/client.js";

export function createTestDb(): { db: AppDb; cleanup: () => void } {
  const dbPath = path.join(os.tmpdir(), `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = runMigrations(dbPath);
  const cleanup = () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = dbPath + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  };
  return { db, cleanup };
}
