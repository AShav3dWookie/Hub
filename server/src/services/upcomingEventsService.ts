import { and, eq, inArray, lt } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs } from "../db/schema.js";
import { getPeopleForLogs } from "./logService.js";
import { toISODate, atMidnightUTC } from "../lib/dates.js";
import type { UpcomingEventEntry, UpcomingEventsResponse } from "@logger/shared";

const EVENT_CATEGORIES = ["hang_out", "appointment"] as const;

/**
 * Future-dated hang-outs and appointments, bucketed into ones landing today and ones landing
 * within the next 7 days (tomorrow..+7 days inclusive). One-off — no annual recurrence.
 *
 * Only events *planned ahead* are surfaced: a log whose `createdAt` date is on or after its event
 * date is treated as an after-the-fact record (you logged the bowling night when you got home), not
 * an upcoming plan, and is excluded.
 */
export function getUpcomingEvents(
  db: AppDb,
  today: Date = new Date(),
): UpcomingEventsResponse {
  const rows = db
    .select({
      logId: logs.id,
      entityId: logs.entityId,
      entityTitle: entities.title,
      category: entities.category,
      date: logs.date,
      notes: logs.notes,
      createdAt: logs.createdAt,
    })
    .from(logs)
    .innerJoin(entities, eq(logs.entityId, entities.id))
    .where(inArray(entities.category, [...EVENT_CATEGORIES]))
    .all();

  const todayISO = toISODate(atMidnightUTC(today));
  const weekEndISO = toISODate(
    (() => {
      const d = atMidnightUTC(today);
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    })(),
  );

  const peopleByLog = getPeopleForLogs(
    db,
    rows.map((r) => r.logId),
  );

  const todayEntries: UpcomingEventEntry[] = [];
  const next7Entries: UpcomingEventEntry[] = [];

  for (const row of rows) {
    // Logged on or after the day it happened → history, not an upcoming plan.
    if (row.createdAt.slice(0, 10) >= row.date) continue;

    const entry: UpcomingEventEntry = {
      logId: row.logId,
      entityId: row.entityId,
      entityTitle: row.entityTitle,
      category: row.category as UpcomingEventEntry["category"],
      date: row.date,
      notes: row.notes,
      people: peopleByLog.get(row.logId) ?? [],
    };
    if (row.date === todayISO) {
      todayEntries.push(entry);
    } else if (row.date > todayISO && row.date <= weekEndISO) {
      next7Entries.push(entry);
    }
  }

  const byDateThenTitle = (a: UpcomingEventEntry, b: UpcomingEventEntry) =>
    a.date.localeCompare(b.date) || a.entityTitle.localeCompare(b.entityTitle);
  todayEntries.sort(byDateThenTitle);
  next7Entries.sort(byDateThenTitle);

  return { today: todayEntries, next7Days: next7Entries };
}

/**
 * Delete appointment logs flagged auto-delete whose date is strictly before today (i.e. the day
 * after the appointment, or later). Returns the number of logs removed. Tagged-people rows
 * cascade; appointments have no photos.
 */
export function sweepExpiredAppointments(db: AppDb, today: Date = new Date()): number {
  const todayISO = toISODate(atMidnightUTC(today));

  const expired = db
    .select({ id: logs.id })
    .from(logs)
    .innerJoin(entities, eq(logs.entityId, entities.id))
    .where(
      and(eq(entities.category, "appointment"), eq(logs.autoDelete, true), lt(logs.date, todayISO)),
    )
    .all()
    .map((r) => r.id);

  if (expired.length === 0) return 0;

  db.delete(logs).where(inArray(logs.id, expired)).run();
  return expired.length;
}
