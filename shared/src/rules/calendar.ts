import type { Category } from "../categories.js";
import type { CalendarItem, CalendarRangeResponse } from "../calendar.js";
import { daysInMonth, pad2 } from "../dates.js";

/**
 * Calendar range assembly, shared by the server's `calendarService` and the offline client's
 * query layer so both place and order items identically.
 *
 * Callers supply already-fetched rows; every filtering and ordering decision is made here.
 * The server narrows its SQL first, which makes the range/category filters below a no-op for
 * it, and the client passes its whole snapshot.
 */

/** Loggable categories whose logs land on the calendar. Movies are deliberately excluded. */
export const CALENDAR_LOG_CATEGORIES: readonly Category[] = [
  "eating_out",
  "hang_out",
  "appointment",
];

export interface CalendarLogRow {
  logId: number;
  date: string;
  notes: string | null;
  entityId: number;
  title: string;
  category: Category;
}

export interface CalendarNoteRow {
  noteId: number;
  /** Only `important_date` notes are placed; anything else is ignored. */
  category: string;
  tag: string | null;
  eventDate: string | null;
  body: string | null;
  entityId: number;
  entityName: string;
  entityCategory: Category;
}

/**
 * Every calendar item whose occurrence falls in [from, to] inclusive (both `YYYY-MM-DD`):
 *
 * - Logs in the calendar categories, by their own date, past and future alike. Unlike the home
 *   "upcoming" widget, after-the-fact logs are NOT filtered out — historical visits are the
 *   whole point — and no auto-delete sweep runs here.
 * - `important_date` notes, placed on their annual month+day occurrence in each year the range
 *   spans. The occurrence is built as a string and never round-tripped through `Date`, so a day
 *   that does not exist in the target year (Feb 29 of a non-leap year, the 31st of a short
 *   month) is skipped rather than rolled forward. This is the deliberate difference from
 *   `nextAnnualOccurrence`, which does roll forward.
 */
export function buildCalendarRange(
  logRows: readonly CalendarLogRow[],
  noteRows: readonly CalendarNoteRow[],
  from: string,
  to: string,
): CalendarRangeResponse {
  const items: CalendarItem[] = [];

  for (const row of logRows) {
    if (row.date < from || row.date > to) continue;
    if (!CALENDAR_LOG_CATEGORIES.includes(row.category)) continue;
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

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  for (const row of noteRows) {
    if (row.category !== "important_date" || !row.tag || !row.eventDate) continue;
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
