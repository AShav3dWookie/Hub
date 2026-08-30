import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, isWalUnsupported } from "./client.js";

describe("isWalUnsupported", () => {
  it("matches the SQLite shared-memory IOERR codes and SQLITE_CANTOPEN", () => {
    for (const code of [
      "SQLITE_IOERR_SHMOPEN",
      "SQLITE_IOERR_SHMSIZE",
      "SQLITE_IOERR_SHMMAP",
      "SQLITE_IOERR_SHMLOCK",
      "SQLITE_CANTOPEN",
    ]) {
      expect(isWalUnsupported(Object.assign(new Error("x"), { code }))).toBe(true);
    }
  });

  it("does not match unrelated errors", () => {
    expect(isWalUnsupported(Object.assign(new Error("x"), { code: "SQLITE_BUSY" }))).toBe(false);
    expect(isWalUnsupported(new Error("plain"))).toBe(false);
    expect(isWalUnsupported("nope")).toBe(false);
  });
});

describe("createDb", () => {
  const paths: string[] = [];
  afterEach(() => {
    for (const p of paths.splice(0)) {
      for (const s of ["", "-wal", "-shm"]) fs.rmSync(p + s, { force: true });
    }
  });

  it("opens a working database (WAL where the filesystem allows it) with FKs on", () => {
    const p = path.join(os.tmpdir(), `client-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    paths.push(p);
    const db = createDb(p);
    db.$client.exec("CREATE TABLE t (id integer primary key, parent integer references t(id))");
    // foreign_keys pragma is applied
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    // journal mode is a valid rollback/WAL mode, not "off"
    expect(["wal", "delete", "truncate", "persist", "memory"]).toContain(
      db.$client.pragma("journal_mode", { simple: true }),
    );
    db.$client.close();
  });
});
