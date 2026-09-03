import type { ImportantDateEntry, UpcomingImportantDatesResponse } from "../types.js";
import { atMidnightUTC, nextAnnualOccurrence, toISODate } from "../dates.js";
import { bucketByWindow } from "./window.js";

/**
 * Home-screen "important dates" bucketing, shared by the server's `importantDatesService` and
 * the offline client's query layer.
 *
 * Callers supply already-fetched note rows joined to their parent entity's name; the
 * recurrence maths, the window and the ordering are all decided here.
 */

export interface ImportantDateNoteRow {
  noteId: number;
  entityId: number;
  entityName: string;
  tag: string | null;
  eventDate: string | null;
  body: string;
  /** Only `important_date` notes are surfaced; anything else is ignored. */
  category?: string;
}

const byOccurrenceThenName = (a: ImportantDateEntry, b: ImportantDateEntry) =>
  a.nextOccurrence.localeCompare(b.nextOccurrence) || a.entityName.localeCompare(b.entityName);

/**
 * All `important_date` notes placed on their next annual occurrence, bucketed into ones landing
 * today and ones landing within the next 7 days (tomorrow..+7 inclusive).
 *
 * A note missing its tag or event date is skipped: those two are required by the API schema for
 * this category, but nothing enforces the invariant at the storage layer, so a row written
 * directly by the sync mutation path could still lack them.
 */
export function bucketImportantDates(
  rows: Iterable<ImportantDateNoteRow>,
  today: Date = new Date(),
): UpcomingImportantDatesResponse {
  const todayUTC = atMidnightUTC(today);
  const entries: ImportantDateEntry[] = [];

  for (const row of rows) {
    if (row.category !== undefined && row.category !== "important_date") continue;
    if (!row.tag || !row.eventDate) continue;
    entries.push({
      noteId: row.noteId,
      entityId: row.entityId,
      entityName: row.entityName,
      tag: row.tag,
      eventDate: row.eventDate,
      nextOccurrence: toISODate(nextAnnualOccurrence(row.eventDate, todayUTC)),
      body: row.body,
    });
  }

  const { today: todayEntries, next7Days } = bucketByWindow(
    entries,
    (entry) => entry.nextOccurrence,
    todayUTC,
    byOccurrenceThenName,
  );

  // Today's bucket is name-ordered: every entry in it shares the same occurrence date, so the
  // occurrence half of the comparator never breaks a tie there.
  todayEntries.sort((a, b) => a.entityName.localeCompare(b.entityName));

  return { today: todayEntries, next7Days };
}
