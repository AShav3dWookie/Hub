import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/** SQLite error codes raised when the filesystem can't back WAL's shared-memory (`-shm`) index. */
const WAL_UNSUPPORTED_CODES = new Set([
  "SQLITE_IOERR_SHMOPEN",
  "SQLITE_IOERR_SHMSIZE",
  "SQLITE_IOERR_SHMMAP",
  "SQLITE_IOERR_SHMLOCK",
  "SQLITE_CANTOPEN",
]);

export function isWalUnsupported(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    WAL_UNSUPPORTED_CODES.has((err as { code: string }).code)
  );
}

export function createDb(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(dbPath);
  try {
    // A fresh DB on a filesystem that can't do WAL just stays in the rollback journal
    // (SQLite returns the prior mode rather than erroring). This throw only fires when
    // there's an existing/contended -wal to open.
    sqlite.pragma("journal_mode = WAL");
  } catch (err) {
    if (!isWalUnsupported(err)) throw err;
    throw new Error(
      `Cannot open the SQLite database at ${dbPath} in WAL mode: this filesystem can't provide ` +
        `WAL's shared-memory (-shm) file. Usually another process has the same database open over ` +
        `a bind mount (e.g. a dev server or a stray test server sharing the container's data ` +
        `directory), or the data directory is on a network filesystem. Close the other process, or ` +
        `give the container a data directory nothing else touches.`,
      { cause: err },
    );
  }
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type AppDb = ReturnType<typeof createDb>;
