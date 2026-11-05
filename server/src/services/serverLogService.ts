import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { serverLogs } from "../db/schema.js";
import { BadRequestError } from "../lib/errors.js";
import { SERVER_LOG_LEVELS, type ServerLogDTO, type ServerLogLevel, type ServerLogSource } from "@logger/shared";

/**
 * The hub's own log — see `server_logs` in the schema and docs/logs.md. Everything that writes
 * here also goes to the console, so `docker logs` keeps working; this copy is the one that
 * survives a recreated container and can be read from the PC with a logs token.
 */

export const LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const LOG_MAX_ROWS = 10_000;
/** Pruning runs on every this-many-th write rather than on each one. */
const PRUNE_EVERY = 100;
const MESSAGE_MAX = 2_000;
const DATA_MAX = 16_000;

export interface LogEntry {
  level: ServerLogLevel;
  source: ServerLogSource;
  message: string;
  data?: Record<string, unknown> | null;
}

// The test suites write hundreds of entries; echoing each one buries the real output.
const mirrorToConsole = !process.env.VITEST;

function toConsole({ level, source, message, data }: LogEntry): void {
  if (!mirrorToConsole) return;
  const line = `[${source}] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`;
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** Bounded, JSON-safe detail: a huge model answer or stack is cut rather than stored whole. */
function boundedData(data: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const json = JSON.stringify(data);
  if (json === undefined) return null;
  return json.length <= DATA_MAX ? (JSON.parse(json) as Record<string, unknown>) : { truncated: json.slice(0, DATA_MAX) };
}

/**
 * Record what the hub did. Never throws: a failing log write must not turn a saved voice
 * command or a sent reminder into an error.
 */
export function writeLog(db: AppDb, entry: LogEntry, now: Date = new Date()): void {
  toConsole(entry);
  try {
    const { id } = db
      .insert(serverLogs)
      .values({
        at: now.toISOString(),
        level: entry.level,
        source: entry.source,
        message: entry.message.slice(0, MESSAGE_MAX),
        data: boundedData(entry.data),
      })
      .returning({ id: serverLogs.id })
      .get();
    if (id % PRUNE_EVERY === 0) pruneLogs(db, now, id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[log] couldn't write a log entry: ${(err as Error).message}`);
  }
}

/**
 * `writeLog`, unless the same source already logged the same message within `withinMs`. For
 * something that would otherwise repeat every minute — a reminder no device accepts, a phone
 * retrying with a revoked token — so it can't push the voice commands out of the row cap.
 */
export function writeLogOnce(db: AppDb, entry: LogEntry, withinMs: number, now: Date = new Date()): void {
  try {
    const recent = db
      .select({ id: serverLogs.id })
      .from(serverLogs)
      .where(
        and(
          eq(serverLogs.source, entry.source),
          eq(serverLogs.message, entry.message.slice(0, MESSAGE_MAX)),
          gte(serverLogs.at, new Date(now.getTime() - withinMs).toISOString()),
        ),
      )
      .get();
    if (recent) return;
  } catch {
    // Fall through: better a repeat than a lost entry.
  }
  writeLog(db, entry, now);
}

/** Drop entries older than the retention window, and the oldest beyond the row cap. */
export function pruneLogs(db: AppDb, now: Date = new Date(), lastId?: number): void {
  db.delete(serverLogs)
    .where(lt(serverLogs.at, new Date(now.getTime() - LOG_RETENTION_MS).toISOString()))
    .run();
  const newest = lastId ?? db.select({ id: serverLogs.id }).from(serverLogs).orderBy(desc(serverLogs.id)).get()?.id;
  if (newest !== undefined) db.delete(serverLogs).where(lte(serverLogs.id, newest - LOG_MAX_ROWS)).run();
}

const DURATION = /^(\d+)\s*(m|h|d)$/i;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** "30m" / "2h" / "3d" back from `now`, or an ISO timestamp. */
export function parseSince(value: string, now: Date = new Date()): string {
  const duration = DURATION.exec(value.trim());
  if (duration) {
    const unit = duration[2].toLowerCase() as keyof typeof UNIT_MS;
    return new Date(now.getTime() - Number(duration[1]) * UNIT_MS[unit]).toISOString();
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new BadRequestError(`"since" should be like 30m, 2h, 3d or an ISO time, not "${value}"`);
  return new Date(ms).toISOString();
}

export interface LogQuery {
  /** ISO timestamp (see `parseSince`). */
  since?: string;
  /** This level and worse: `warn` returns warnings and errors. */
  level?: ServerLogLevel;
  source?: ServerLogSource;
  limit?: number;
}

export const DEFAULT_LOG_LIMIT = 200;

/** The newest `limit` matching entries, oldest first — the way a log reads. */
export function listLogs(db: AppDb, { since, level, source, limit = DEFAULT_LOG_LIMIT }: LogQuery = {}): ServerLogDTO[] {
  const levels = level ? SERVER_LOG_LEVELS.slice(SERVER_LOG_LEVELS.indexOf(level)) : null;
  const rows = db
    .select()
    .from(serverLogs)
    .where(
      and(
        since ? gte(serverLogs.at, since) : undefined,
        levels ? inArray(serverLogs.level, [...levels]) : undefined,
        source ? eq(serverLogs.source, source) : undefined,
      ),
    )
    .orderBy(desc(serverLogs.id))
    .limit(limit)
    .all();
  return rows.reverse().map((r) => ({ ...r, data: r.data ?? null }));
}

/** One line per entry, for a terminal: `2026-11-05T14:03:12Z WARN  voice  message {data}`. */
export function formatLogs(entries: readonly ServerLogDTO[]): string {
  return entries
    .map((e) => {
      const at = e.at.replace(/\.\d{3}Z$/, "Z");
      const data = e.data ? ` ${JSON.stringify(e.data)}` : "";
      return `${at} ${e.level.toUpperCase().padEnd(5)} ${e.source.padEnd(13)} ${e.message}${data}`;
    })
    .join("\n");
}
