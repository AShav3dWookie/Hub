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
    // Two FKs now (logs + albums), order not guaranteed — look each up by target table.
    expect(fks.find((f) => f.table === "logs")).toMatchObject({ on_delete: "SET NULL" });
    expect(fks.find((f) => f.table === "albums")).toMatchObject({ on_delete: "SET NULL" });

    const logCols = client.prepare("PRAGMA table_info(logs)").all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const autoDelete = logCols.find((c) => c.name === "auto_delete")!;
    expect(autoDelete).toMatchObject({ notnull: 1 });
    expect(autoDelete.dflt_value).toBe("false");

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

  it("0006 adds the album tables and a SET NULL log_photos.album_id, preserving rows", () => {
    const dbPath = tmpDb();
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");

    for (const tag of [
      "0000_many_rhodey",
      "0001_overjoyed_hardball",
      "0002_blue_weapon_omega",
      "0003_graceful_umar",
      "0004_volatile_killraven",
      "0005_curvy_meltdown",
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

    applyMigrationFile(db, "0006_awesome_catseye");

    // Existing photo row untouched, new column defaults to NULL.
    const photo = db.prepare("SELECT * FROM log_photos").get() as Record<string, unknown>;
    expect(photo).toMatchObject({ log_id: 1, filename: "a.jpg", album_id: null });

    // New tables exist.
    for (const table of ["albums", "album_events", "album_people"]) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
    }

    // Deleting an album SET NULLs a loose photo's album_id (keeps it as an orphan).
    db.prepare("INSERT INTO albums (title) VALUES ('Trip')").run();
    db.prepare(
      `INSERT INTO log_photos (album_id, filename, thumbnail_filename, original_name, mime_type, size)
       VALUES (1, 'b.jpg', 'b_thumb.webp', 'orig2.jpg', 'image/jpeg', 5678)`,
    ).run();
    db.prepare("DELETE FROM albums WHERE id = 1").run();
    const loose = db.prepare("SELECT album_id FROM log_photos WHERE filename = 'b.jpg'").get() as {
      album_id: number | null;
    };
    expect(loose.album_id).toBeNull();

    db.close();
  });

  it("runMigrations seeds sync_state and installs the change-feed triggers", () => {
    const db = runMigrations(tmpDb());
    const client = db.$client;

    expect(client.prepare("SELECT * FROM sync_state").get()).toMatchObject({
      id: 1,
      next_row_seq: 1,
    });

    const triggers = (
      client.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    for (const t of [
      "entities_sync_ai",
      "entities_sync_au",
      "entities_sync_ad",
      "logs_sync_ai",
      "log_photos_sync_ad",
      "album_events_sync_ad",
      "log_people_sync_ai",
    ]) {
      expect(triggers).toContain(t);
    }

    client.close();
  });

  it("0007 backfills row_seq as a contiguous global ordering over existing rows", () => {
    const dbPath = tmpDb();
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    db.pragma("recursive_triggers = ON");

    for (const tag of [
      "0000_many_rhodey",
      "0001_overjoyed_hardball",
      "0002_blue_weapon_omega",
      "0003_graceful_umar",
      "0004_volatile_killraven",
      "0005_curvy_meltdown",
      "0006_awesome_catseye",
    ]) {
      applyMigrationFile(db, tag);
    }

    db.prepare(
      "INSERT INTO entities (category, title, normalized_title) VALUES ('movie', 'Heat', 'heat')",
    ).run();
    db.prepare(
      "INSERT INTO entities (category, title, normalized_title) VALUES ('movie', 'Ronin', 'ronin')",
    ).run();
    db.prepare("INSERT INTO logs (entity_id, date) VALUES (1, '2024-01-01')").run();
    db.prepare("INSERT INTO entity_notes (entity_id, body) VALUES (1, 'note')").run();

    applyMigrationFile(db, "0007_slimy_elektra");

    const seqs = [
      ...(db.prepare("SELECT row_seq FROM entities ORDER BY id").all() as Array<{ row_seq: number }>),
      ...(db.prepare("SELECT row_seq FROM logs ORDER BY id").all() as Array<{ row_seq: number }>),
      ...(db.prepare("SELECT row_seq FROM entity_notes ORDER BY id").all() as Array<{
        row_seq: number;
      }>),
    ].map((r) => r.row_seq);
    // entities 1,2 → logs 3 → entity_notes 4 (log_photos and albums are empty)
    expect(seqs).toEqual([1, 2, 3, 4]);
    expect(db.prepare("SELECT next_row_seq FROM sync_state").get()).toMatchObject({
      next_row_seq: 5,
    });

    db.close();
  });

  it("0007 triggers: inserts/updates assign row_seq, deletes tombstone, cascades and join edits propagate", () => {
    const db = runMigrations(tmpDb());
    const c = db.$client;
    const seq = (t: string, id: number) =>
      (c.prepare(`SELECT row_seq FROM ${t} WHERE id = ?`).get(id) as { row_seq: number }).row_seq;

    c.prepare(
      "INSERT INTO entities (category, title, normalized_title) VALUES ('movie', 'Heat', 'heat')",
    ).run();
    c.prepare(
      "INSERT INTO entities (category, title, normalized_title) VALUES ('person', 'Sam', 'sam')",
    ).run();
    c.prepare("INSERT INTO logs (entity_id, date) VALUES (1, '2024-01-01')").run();

    // Inserts claimed increasing row_seq; the counter moved past them.
    expect(seq("entities", 1)).toBe(1);
    expect(seq("entities", 2)).toBe(2);
    expect(seq("logs", 1)).toBe(3);
    expect(c.prepare("SELECT next_row_seq FROM sync_state").get()).toMatchObject({ next_row_seq: 4 });

    // Update bumps row_seq and version.
    c.prepare("UPDATE logs SET rating = 5 WHERE id = 1").run();
    expect(seq("logs", 1)).toBe(4);
    expect(c.prepare("SELECT version FROM logs WHERE id = 1").get()).toMatchObject({ version: 2 });

    // Tagging a person on the log bumps the log via its parent trigger.
    c.prepare("INSERT INTO log_people (log_id, person_entity_id) VALUES (1, 2)").run();
    expect(seq("logs", 1)).toBe(5);

    // Deleting the log writes a tombstone with a fresh row_seq.
    c.prepare("INSERT INTO albums (title) VALUES ('Trip')").run(); // row_seq 6
    c.prepare("INSERT INTO album_events (album_id, log_id) VALUES (1, 1)").run(); // bumps album → 7
    expect(seq("albums", 1)).toBe(7);

    c.prepare("DELETE FROM logs WHERE id = 1").run();
    const tomb = c
      .prepare("SELECT * FROM sync_deletions WHERE entity_type = 'log' AND entity_id = 1")
      .get() as { row_seq: number; deleted_at: string };
    expect(tomb.row_seq).toBeGreaterThan(7);
    expect(tomb.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The cascade removed album_events(1,1); the album was re-sequenced past its pre-delete value.
    expect(seq("albums", 1)).toBeGreaterThan(7);

    c.close();
  });

  it("0008 creates sync_applied_mutations (plain table, no triggers, not in the change feed)", () => {
    const db = runMigrations(tmpDb());
    const c = db.$client;

    const cols = (c.prepare("PRAGMA table_info(sync_applied_mutations)").all() as Array<{
      name: string;
      notnull: number;
      pk: number;
    }>).reduce<Record<string, { notnull: number; pk: number }>>((acc, col) => {
      acc[col.name] = { notnull: col.notnull, pk: col.pk };
      return acc;
    }, {});
    expect(cols).toMatchObject({
      mutation_id: { pk: 1 },
      result_json: { notnull: 1 },
      created_at: { notnull: 1 },
    });

    // No sync triggers were installed for it — it must not feed the change feed.
    const triggers = (
      c.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(triggers.some((t) => t.startsWith("sync_applied_mutations"))).toBe(false);

    c.close();
  });
});
