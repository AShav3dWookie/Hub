import { and, eq, inArray, lt } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs } from "../db/schema.js";
import { getPeopleForLogs } from "./logService.js";
import {
  EVENT_CATEGORIES,
  atMidnightUTC,
  bucketUpcomingEvents,
  toISODate,
  type UpcomingEventsResponse,
} from "@logger/shared";

/**
 * Future-dated hang-outs and appointments, bucketed into ones landing today and ones landing
 * within the next 7 days. One-off — no annual recurrence.
 *
 * Which rows qualify, how they are windowed and how they are ordered all live in
 * `@logger/shared`, so the offline client's query layer agrees with this exactly.
 */
export function getUpcomingEvents(db: AppDb, today: Date = new Date()): UpcomingEventsResponse {
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

  const peopleByLog = getPeopleForLogs(
    db,
    rows.map((r) => r.logId),
  );

  return bucketUpcomingEvents(
    rows.map((row) => ({ ...row, people: peopleByLog.get(row.logId) ?? [] })),
    today,
  );
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
