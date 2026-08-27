import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";

const drizzleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

function applyMigrationFile(db: Database.Database, tag: string) {
  const sql = fs.readFileSync(path.join(drizzleDir, `${tag}.sql`), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) db.exec(trimmed);
  }
}

describe("migrations", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const p of created.splice(0)) {
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(p + suffix, { force: true });
    }
  });

  function tmpDb() {
    const p = path.join(os.tmpdir(), `mig-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    created.push(p);
    return p;
  }

  it("runMigrations produces a log_photos table with a nullable, SET NULL log_id", () => {
    const db = runMigrations(tmpDb());
    const client = db.$client;

    const cols = client.prepare("PRAGMA table_info(log_photos)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const logId = cols.find((c) => c.name === "log_id")!;
    expect(logId.notnull).toBe(0); // nullable

    const fks = client.prepare("PRAGMA foreign_key_list(log_photos)").all() as Array<{
      table: string;
      on_delete: string;
    }>;
    expect(fks[0]).toMatchObject({ table: "logs", on_delete: "SET NULL" });

    client.close();
  });

  it("the 0004 table-recreate preserves existing log_photos rows", () => {
    const dbPath = tmpDb();
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");

    // Replay the schema as it stood *before* 0004.
    for (const tag of [
      "0000_many_rhodey",
      "0001_overjoyed_hardball",
      "0002_blue_weapon_omega",
      "0003_graceful_umar",
    ]) {
      applyMigrationFile(db, tag);
    }

    db.prepare(
      "INSERT INTO entities (category, title, normalized_title) VALUES ('movie', 'Heat', 'heat')",
    ).run();
    db.prepare("INSERT INTO logs (entity_id, date) VALUES (1, '2024-01-01')").run();
    db.prepare(
      `INSERT INTO log_photos (log_id, filename, thumbnail_filename, original_name, mime_type, size)
       VALUES (1, 'a.jpg', 'a_thumb.webp', 'orig.jpg', 'image/jpeg', 1234)`,
    ).run();

    applyMigrationFile(db, "0004_volatile_killraven");

    const rows = db.prepare("SELECT * FROM log_photos").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      log_id: 1,
      filename: "a.jpg",
      thumbnail_filename: "a_thumb.webp",
      original_name: "orig.jpg",
      mime_type: "image/jpeg",
      size: 1234,
    });

    // The index survived the recreate.
    const idx = db.prepare("PRAGMA index_list(log_photos)").all() as Array<{ name: string }>;
    expect(idx.some((i) => i.name === "log_photos_log_id_idx")).toBe(true);

    // Deleting the log now orphans the photo instead of cascading.
    db.prepare("DELETE FROM logs WHERE id = 1").run();
    const after = db.prepare("SELECT log_id FROM log_photos").all() as Array<{ log_id: number | null }>;
    expect(after).toHaveLength(1);
    expect(after[0].log_id).toBeNull();

    db.close();
  });
});
