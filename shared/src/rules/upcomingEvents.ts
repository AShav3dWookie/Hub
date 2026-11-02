import type { Category } from "../categories.js";
import type { PersonRef, UpcomingEventEntry, UpcomingEventsResponse } from "../types.js";
import { bucketByWindow } from "./window.js";
import { compareTimeOfDay } from "./timeOfDay.js";

/**
 * Home-screen "upcoming events" bucketing, shared by the server's `upcomingEventsService` and
 * the offline client's query layer.
 */

/** Loggable categories that count as a planned event. One-off — no annual recurrence. */
export const EVENT_CATEGORIES: readonly Category[] = ["hang_out", "appointment"];

export interface UpcomingEventLogRow {
  logId: number;
  entityId: number;
  entityTitle: string;
  category: Category;
  date: string;
  /** Appointments' local `HH:MM`; null or absent when untimed. */
  time?: string | null;
  notes: string | null;
  /** ISO timestamp; its date half decides whether this was planned ahead or logged after. */
  createdAt: string;
  people: PersonRef[];
}

/** Same-day items: untimed first, then by time, then by title. */
const byDateTimeThenTitle = (a: UpcomingEventEntry, b: UpcomingEventEntry) =>
  a.date.localeCompare(b.date) ||
  compareTimeOfDay(a.time, b.time) ||
  a.entityTitle.localeCompare(b.entityTitle);

/**
 * Whether a row is a plan rather than an after-the-fact record. A log created on or after the
 * day it happened is history (you logged the bowling night when you got home), not something
 * still to come, so the home widget never surfaces it.
 *
 * A timed one is a plan if it was created before its start, so "haircut at 5" said that
 * morning still counts. `createdAt` is UTC and the time is local, so near the start this can be
 * out by the zone's offset (an hour in BST); nothing reminds after the start anyway.
 */
export function isPlannedAhead(row: Pick<UpcomingEventLogRow, "createdAt" | "date" | "time">): boolean {
  if (row.time) {
    return `${row.createdAt.slice(0, 10)} ${row.createdAt.slice(11, 16)}` < `${row.date} ${row.time}`;
  }
  return row.createdAt.slice(0, 10) < row.date;
}

/**
 * Future-dated hang-outs and appointments, bucketed into ones landing today and ones landing
 * within the next 7 days (tomorrow..+7 inclusive).
 */
export function bucketUpcomingEvents(
  rows: Iterable<UpcomingEventLogRow>,
  today: Date = new Date(),
): UpcomingEventsResponse {
  const entries: UpcomingEventEntry[] = [];

  for (const row of rows) {
    if (!EVENT_CATEGORIES.includes(row.category)) continue;
    if (!isPlannedAhead(row)) continue;
    entries.push({
      logId: row.logId,
      entityId: row.entityId,
      entityTitle: row.entityTitle,
      category: row.category as UpcomingEventEntry["category"],
      date: row.date,
      time: row.time ?? null,
      notes: row.notes,
      people: row.people,
    });
  }

  return bucketByWindow(entries, (entry) => entry.date, today, byDateTimeThenTitle);
}
