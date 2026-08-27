import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entityNotes, entities } from "../db/schema.js";
import type { ImportantDateEntry, UpcomingImportantDatesResponse } from "@logger/shared";
import { toISODate, atMidnightUTC } from "../lib/dates.js";

/** Compute the next annual occurrence (by month+day) of `eventDate` on or after `today`. */
function nextOccurrence(eventDate: string, today: Date): Date {
  const [, month, day] = eventDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
  if (candidate.getTime() < today.getTime()) {
    return new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
  }
  return candidate;
}

/**
 * All "important_date" notes, bucketed into ones landing today and ones landing within the
 * next 7 days (tomorrow..+7 days inclusive), based on annual month+day recurrence.
 */
export function getUpcomingImportantDates(
  db: AppDb,
  today: Date = new Date(),
): UpcomingImportantDatesResponse {
  const rows = db
    .select({
      noteId: entityNotes.id,
      entityId: entityNotes.entityId,
      entityName: entities.title,
      tag: entityNotes.tag,
      eventDate: entityNotes.eventDate,
      body: entityNotes.body,
    })
    .from(entityNotes)
    .innerJoin(entities, eq(entityNotes.entityId, entities.id))
    .where(eq(entityNotes.category, "important_date"))
    .all();

  const todayUTC = atMidnightUTC(today);
  const todayISO = toISODate(todayUTC);
  const weekEnd = new Date(todayUTC);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const todayEntries: ImportantDateEntry[] = [];
  const next7Entries: ImportantDateEntry[] = [];

  for (const row of rows) {
    if (!row.tag || !row.eventDate) continue;
    const occurrence = nextOccurrence(row.eventDate, todayUTC);
    const occurrenceISO = toISODate(occurrence);
    const entry: ImportantDateEntry = {
      noteId: row.noteId,
      entityId: row.entityId,
      entityName: row.entityName,
      tag: row.tag,
      eventDate: row.eventDate,
      nextOccurrence: occurrenceISO,
      body: row.body,
    };
    if (occurrenceISO === todayISO) {
      todayEntries.push(entry);
    } else if (occurrence.getTime() > todayUTC.getTime() && occurrence.getTime() <= weekEnd.getTime()) {
      next7Entries.push(entry);
    }
  }

  todayEntries.sort((a, b) => a.entityName.localeCompare(b.entityName));
  next7Entries.sort(
    (a, b) => a.nextOccurrence.localeCompare(b.nextOccurrence) || a.entityName.localeCompare(b.entityName),
  );

  return { today: todayEntries, next7Days: next7Entries };
}
