import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { serverLogs } from "../db/schema.js";
import {
  LOG_MAX_ROWS,
  LOG_RETENTION_MS,
  formatLogs,
  listLogs,
  parseSince,
  pruneLogs,
  writeLog,
  writeLogOnce,
} from "./serverLogService.js";
import { BadRequestError } from "../lib/errors.js";

const NOW = new Date("2026-11-05T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("serverLogService", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  it("reads back what was written, oldest first, with its detail", () => {
    ctx = createTestDb();
    writeLog(ctx.db, { level: "info", source: "server", message: "Started 1.4.1" }, minutesAgo(10));
    writeLog(ctx.db, { level: "warn", source: "voice", message: "fell back", data: { text: "dentist" } }, minutesAgo(5));

    expect(listLogs(ctx.db)).toMatchObject([
      { level: "info", source: "server", message: "Started 1.4.1", data: null, at: minutesAgo(10).toISOString() },
      { level: "warn", source: "voice", message: "fell back", data: { text: "dentist" } },
    ]);
  });

  it("filters by time, source and a minimum level, and keeps the newest when limited", () => {
    ctx = createTestDb();
    writeLog(ctx.db, { level: "error", source: "http", message: "old 500" }, minutesAgo(180));
    writeLog(ctx.db, { level: "info", source: "voice", message: "a" }, minutesAgo(30));
    writeLog(ctx.db, { level: "warn", source: "voice", message: "b" }, minutesAgo(20));
    writeLog(ctx.db, { level: "error", source: "notifications", message: "c" }, minutesAgo(10));

    const messages = (q: Parameters<typeof listLogs>[1]) => listLogs(ctx.db, q).map((e) => e.message);
    expect(messages({ since: minutesAgo(60).toISOString() })).toEqual(["a", "b", "c"]);
    expect(messages({ source: "voice" })).toEqual(["a", "b"]);
    expect(messages({ level: "warn" })).toEqual(["old 500", "b", "c"]);
    expect(messages({ level: "error", since: minutesAgo(60).toISOString() })).toEqual(["c"]);
    expect(messages({ limit: 2 })).toEqual(["b", "c"]);
  });

  it("drops entries past the retention window and beyond the row cap", () => {
    ctx = createTestDb();
    writeLog(ctx.db, { level: "info", source: "server", message: "ancient" }, new Date(NOW.getTime() - LOG_RETENTION_MS - 1));
    writeLog(ctx.db, { level: "info", source: "server", message: "recent" }, NOW);
    pruneLogs(ctx.db, NOW);
    expect(listLogs(ctx.db).map((e) => e.message)).toEqual(["recent"]);

    const rows = Array.from({ length: LOG_MAX_ROWS + 5 }, (_, i) => ({
      at: NOW.toISOString(),
      level: "info" as const,
      source: "voice" as const,
      message: `#${i}`,
    }));
    for (let i = 0; i < rows.length; i += 500) ctx.db.insert(serverLogs).values(rows.slice(i, i + 500)).run();
    pruneLogs(ctx.db, NOW);
    const left = listLogs(ctx.db, { limit: LOG_MAX_ROWS + 10 });
    expect(left).toHaveLength(LOG_MAX_ROWS);
    expect(left.at(-1)?.message).toBe(`#${LOG_MAX_ROWS + 4}`);
  });

  it("logs a repeating message once per window", () => {
    ctx = createTestDb();
    const entry = { level: "warn", source: "notifications", message: "No device accepted it" } as const;
    writeLogOnce(ctx.db, entry, 60 * 60_000, minutesAgo(30));
    writeLogOnce(ctx.db, entry, 60 * 60_000, minutesAgo(29));
    writeLogOnce(ctx.db, { ...entry, message: "Something else" }, 60 * 60_000, minutesAgo(28));
    writeLogOnce(ctx.db, entry, 60 * 60_000, new Date(minutesAgo(30).getTime() + 61 * 60_000));
    expect(listLogs(ctx.db).map((e) => e.message)).toEqual([
      "No device accepted it",
      "Something else",
      "No device accepted it",
    ]);
  });

  it("cuts an oversized detail rather than storing it whole", () => {
    ctx = createTestDb();
    writeLog(ctx.db, { level: "error", source: "http", message: "big", data: { stack: "x".repeat(50_000) } });
    const [entry] = listLogs(ctx.db);
    expect(JSON.stringify(entry.data).length).toBeLessThan(17_000);
    expect(entry.data).toHaveProperty("truncated");
  });

  it("never throws, even when the database is gone", () => {
    ctx = createTestDb();
    ctx.db.$client.close();
    expect(() => writeLog(ctx.db, { level: "info", source: "server", message: "lost" })).not.toThrow();
  });

  it("reads a duration or an ISO time as 'since', and refuses anything else", () => {
    expect(parseSince("30m", NOW)).toBe(minutesAgo(30).toISOString());
    expect(parseSince("2h", NOW)).toBe(minutesAgo(120).toISOString());
    expect(parseSince("3d", NOW)).toBe(minutesAgo(3 * 24 * 60).toISOString());
    expect(parseSince("2026-11-05T10:00:00+01:00", NOW)).toBe("2026-11-05T09:00:00.000Z");
    expect(() => parseSince("yesterday", NOW)).toThrow(BadRequestError);
  });

  it("formats one line per entry for a terminal", () => {
    expect(
      formatLogs([
        { id: 1, at: "2026-11-05T12:00:00.123Z", level: "warn", source: "voice", message: "fell back", data: { a: 1 } },
        { id: 2, at: "2026-11-05T12:01:00.000Z", level: "info", source: "server", message: "Started", data: null },
      ]),
    ).toBe(
      '2026-11-05T12:00:00Z WARN  voice         fell back {"a":1}\n2026-11-05T12:01:00Z INFO  server        Started',
    );
  });
});
