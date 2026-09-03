import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, entityNotes, logs } from "../db/schema.js";
import {
  CALENDAR_LOG_CATEGORIES,
  buildCalendarRange,
  type CalendarRangeResponse,
} from "@logger/shared";

/**
 * Every calendar item whose occurrence falls in [from, to] inclusive (both YYYY-MM-DD).
 *
 * The SQL below only narrows what has to be read; the placement of annual `important_date`
 * occurrences and the ordering of the result are decided by `buildCalendarRange` in
 * `@logger/shared`, which the offline client calls with the same rows from its replica.
 */
export function getCalendarRange(db: AppDb, from: string, to: string): CalendarRangeResponse {
  const logRows = db
    .select({
      logId: logs.id,
      date: logs.date,
      notes: logs.notes,
      entityId: entities.id,
      title: entities.title,
      category: entities.category,
    })
    .from(logs)
    .innerJoin(entities, eq(logs.entityId, entities.id))
    .where(
      and(
        inArray(entities.category, [...CALENDAR_LOG_CATEGORIES]),
        gte(logs.date, from),
        lte(logs.date, to),
      ),
    )
    .all();

  const noteRows = db
    .select({
      noteId: entityNotes.id,
      category: entityNotes.category,
      tag: entityNotes.tag,
      eventDate: entityNotes.eventDate,
      body: entityNotes.body,
      entityId: entities.id,
      entityName: entities.title,
      entityCategory: entities.category,
    })
    .from(entityNotes)
    .innerJoin(entities, eq(entityNotes.entityId, entities.id))
    .where(eq(entityNotes.category, "important_date"))
    .all();

  return buildCalendarRange(logRows, noteRows, from, to);
}
