import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, entityNotes, logs } from "../db/schema.js";
import { daysInMonth } from "../lib/dates.js";
import type { CalendarItem, CalendarRangeResponse } from "@logger/shared";

/** Loggable categories whose logs land on the calendar. Movies are deliberately excluded. */
const CALENDAR_LOG_CATEGORIES = ["eating_out", "hang_out", "appointment"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Every calendar item whose occurrence falls in [from, to] inclusive (both YYYY-MM-DD):
 *
 * - `logs` in the calendar categories, by `logs.date` — past and future alike. (Unlike the
 *   home "upcoming" widget, after-the-fact logs are NOT filtered out — historical visits are
 *   the whole point — and no auto-delete sweep runs here.)
 * - `important_date` notes, placed on their annual month+day occurrence in each year the range
 *   spans. The occurrence date is built as a string; it is never round-tripped through `Date`
 *   (that is why `importantDatesService.nextOccurrence` turns Feb 29 into Mar 1). A day that
 *   doesn't exist in the target month (Feb 29 of a non-leap year, the 31st of a short month) is
 *   skipped, never rolled forward.
 */
export function getCalendarRange(db: AppDb, from: string, to: string): CalendarRangeResponse {
  const items: CalendarItem[] = [];

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

  for (const row of logRows) {
    items.push({
      date: row.date,
      kind: "log",
      category: row.category as CalendarItem["category"],
      title: row.title,
      notes: row.notes,
      entityId: row.entityId,
      entityCategory: row.category,
      logId: row.logId,
    });
  }

  const noteRows = db
    .select({
      noteId: entityNotes.id,
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

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  for (const row of noteRows) {
    if (!row.tag || !row.eventDate) continue;
    const [, mm, dd] = row.eventDate.slice(0, 10).split("-").map(Number);
    if (!mm || !dd) continue;
    for (let year = fromYear; year <= toYear; year++) {
      if (dd > daysInMonth(year, mm)) continue; // day doesn't exist this year — skip, never roll
      const iso = `${year}-${pad2(mm)}-${pad2(dd)}`;
      if (iso < from || iso > to) continue;
      items.push({
        date: iso,
        kind: "important_date",
        category: "important_date",
        title: row.entityName,
        notes: row.body || null,
        entityId: row.entityId,
        entityCategory: row.entityCategory,
        tag: row.tag,
        noteId: row.noteId,
      });
    }
  }

  items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.title.localeCompare(b.title) ||
      a.kind.localeCompare(b.kind) ||
      (a.logId ?? a.noteId ?? 0) - (b.logId ?? b.noteId ?? 0),
  );

  return { from, to, items };
}
