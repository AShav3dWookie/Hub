import { nextAnnualOccurrence, toISODate } from "../dates.js";
import type { ImportantDateNoteRow } from "./importantDates.js";
import { EVENT_CATEGORIES, isPlannedAhead, type UpcomingEventLogRow } from "./upcomingEvents.js";
import { compareTimeOfDay, minutesOfDay } from "./timeOfDay.js";

/**
 * Push-notification rules: which items a reminder slot covers and what the notification says.
 *
 * Only the server schedules notifications, but the rules live here because they must agree with
 * the home "What's on" widget — an item that shows there as "Today" is exactly an item the 9am
 * notification names. They are built from the same qualification rules the widget uses.
 */

/** `hour_before` is not a fixed-time slot: see `HOUR_BEFORE` and `appointmentsStartingSoon`. */
export type NotificationSlot = "morning" | "week_ahead" | "evening" | "hour_before";

export interface NotificationSlotConfig {
  slot: NotificationSlot;
  /** Heading the notification uses for this slot's items. */
  heading: string;
  /** Local minutes after midnight at which the slot opens. */
  startMinute: number;
  /**
   * Local minute at which the slot closes (exclusive). A slot missed at its start — the server was
   * down, or the item was added afterwards — is still sent late, but never after this.
   */
  endMinute: number;
  /** Which day's items the slot covers, relative to the local date it fires on. */
  dayOffset: number;
  /** Only important dates whose tag is a birthday. */
  birthdaysOnly: boolean;
  /** Leave out timed appointments: they get their own reminder an hour before instead. */
  untimedOnly: boolean;
}

/** In send order: slots sharing a start time are merged into one notification, in this order. */
export const NOTIFICATION_SLOTS: readonly NotificationSlotConfig[] = [
  { slot: "morning", heading: "Today", startMinute: 9 * 60, endMinute: 12 * 60, dayOffset: 0, birthdaysOnly: false, untimedOnly: true },
  { slot: "week_ahead", heading: "In a week", startMinute: 9 * 60, endMinute: 12 * 60, dayOffset: 7, birthdaysOnly: true, untimedOnly: false },
  { slot: "evening", heading: "Tomorrow", startMinute: 21 * 60, endMinute: 24 * 60, dayOffset: 1, birthdaysOnly: false, untimedOnly: false },
];

/**
 * A timed appointment's own reminder. Its window runs from `leadMinutes` before the start up to
 * the start (exclusive): the scheduler's minute tick sends it as the window opens, and nothing is
 * sent once the appointment has begun. It replaces the 9am "Today" for that appointment; the 9pm
 * "Tomorrow" the night before still names it, with its time.
 */
export const HOUR_BEFORE = { slot: "hour_before", heading: "In an hour", leadMinutes: 60 } as const;

export interface NotificationItem {
  /** Stable identity used to never notify about the same thing twice: `note:<id>` or `log:<id>`. */
  key: string;
  /** What the notification says about it, e.g. "Sarah — Birthday" or "Bowling with Ada". */
  label: string;
}

/** Whether an important date's free-text tag marks a birthday ("Birthday", "30th birthday", …). */
export function isBirthdayTag(tag: string | null | undefined): boolean {
  return !!tag && tag.toLowerCase().includes("birthday");
}

interface Sortable extends NotificationItem {
  time: string | null;
  name: string;
  kind: number;
  id: number;
}

/**
 * Every item landing on `dateISO` (`YYYY-MM-DD`):
 *
 * - `important_date` notes whose next annual occurrence on or after that date IS that date — the
 *   same `nextAnnualOccurrence` the home widget uses, so a Feb 29 birthday is announced on Mar 1
 *   in a non-leap year, exactly where Home shows it.
 * - Hang-outs and appointments on that date that were planned ahead (`isPlannedAhead`); a log
 *   written after the fact is history, not a reminder.
 *
 * `untimedOnly` leaves out appointments with a time (the 9am slot: they remind an hour before).
 *
 * Ordered as the day reads: untimed first, then by time, then name, notes before logs, id.
 */
export function itemsOccurringOn(
  noteRows: Iterable<ImportantDateNoteRow>,
  eventRows: Iterable<UpcomingEventLogRow>,
  dateISO: string,
  { birthdaysOnly = false, untimedOnly = false }: { birthdaysOnly?: boolean; untimedOnly?: boolean } = {},
): NotificationItem[] {
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  const items: Sortable[] = [];

  for (const row of noteRows) {
    if (row.category !== undefined && row.category !== "important_date") continue;
    if (!row.tag || !row.eventDate) continue;
    if (birthdaysOnly && !isBirthdayTag(row.tag)) continue;
    if (toISODate(nextAnnualOccurrence(row.eventDate, date)) !== dateISO) continue;
    items.push({
      key: `note:${row.noteId}`,
      label: `${row.entityName} — ${row.tag}`,
      time: null,
      name: row.entityName,
      kind: 0,
      id: row.noteId,
    });
  }

  if (!birthdaysOnly) {
    for (const row of eventRows) {
      if (!EVENT_CATEGORIES.includes(row.category)) continue;
      if (row.date !== dateISO || !isPlannedAhead(row)) continue;
      if (untimedOnly && row.time) continue;
      items.push({
        key: `log:${row.logId}`,
        label: eventLabel(row),
        time: row.time ?? null,
        name: row.entityTitle,
        kind: 1,
        id: row.logId,
      });
    }
  }

  items.sort(
    (a, b) =>
      compareTimeOfDay(a.time, b.time) || a.name.localeCompare(b.name) || a.kind - b.kind || a.id - b.id,
  );
  return items.map(({ key, label }) => ({ key, label }));
}

/** "Bowling with Ada, Zoe", "Dentist at 15:00". */
function eventLabel(row: UpcomingEventLogRow): string {
  const withWho = row.people.length > 0 ? ` with ${row.people.map((p) => p.name).join(", ")}` : "";
  return `${row.entityTitle}${withWho}${row.time ? ` at ${row.time}` : ""}`;
}

export interface StartingSoon {
  /** The appointment's own date: what its delivery is recorded under, so a reminder whose window
   * spans midnight is still sent once. */
  dateISO: string;
  item: NotificationItem;
  /** Minutes until it starts, 1–60: how long the reminder is still worth delivering. */
  startsIn: number;
}

/**
 * Timed appointments whose hour-before window is open at local `minutes` past midnight on
 * `dateISO`: starting within the next `HOUR_BEFORE.leadMinutes`, not yet started. Tomorrow's are
 * looked at too, so a 00:30 appointment reminds at 23:30. Only plans count (`isPlannedAhead`),
 * as for every other reminder. Ordered by start, then title, then id.
 */
export function appointmentsStartingSoon(
  eventRows: Iterable<UpcomingEventLogRow>,
  dateISO: string,
  minutes: number,
  tomorrowISO: string,
): StartingSoon[] {
  const soon: (StartingSoon & { title: string; id: number })[] = [];
  for (const row of eventRows) {
    if (row.category !== "appointment" || !row.time || !isPlannedAhead(row)) continue;
    const dayOffset = row.date === dateISO ? 0 : row.date === tomorrowISO ? 24 * 60 : null;
    if (dayOffset === null) continue;
    const startsIn = dayOffset + minutesOfDay(row.time) - minutes;
    if (startsIn <= 0 || startsIn > HOUR_BEFORE.leadMinutes) continue;
    soon.push({
      dateISO: row.date,
      item: { key: `log:${row.logId}`, label: eventLabel(row) },
      startsIn,
      title: row.entityTitle,
      id: row.logId,
    });
  }
  soon.sort((a, b) => a.startsIn - b.startsIn || a.title.localeCompare(b.title) || a.id - b.id);
  return soon.map(({ dateISO: date, item, startsIn }) => ({ dateISO: date, item, startsIn }));
}

export interface NotificationSection {
  heading: string;
  items: readonly NotificationItem[];
}

export interface NotificationMessage {
  title: string;
  body: string;
}

/**
 * One notification for several slots' worth of items. The first non-empty section names the
 * notification and fills the first line; any later section gets its own `Heading: …` line.
 * `null` when there is nothing to say.
 */
export function summariseNotification(
  sections: readonly NotificationSection[],
): NotificationMessage | null {
  const nonEmpty = sections.filter((s) => s.items.length > 0);
  if (nonEmpty.length === 0) return null;

  const join = (items: readonly NotificationItem[]) => items.map((i) => i.label).join(" · ");
  const [first, ...rest] = nonEmpty;
  return {
    title: first.heading,
    body: [join(first.items), ...rest.map((s) => `${s.heading}: ${join(s.items)}`)].join("\n"),
  };
}
