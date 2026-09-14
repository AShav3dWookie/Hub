import { nextAnnualOccurrence, toISODate } from "../dates.js";
import type { ImportantDateNoteRow } from "./importantDates.js";
import { EVENT_CATEGORIES, isPlannedAhead, type UpcomingEventLogRow } from "./upcomingEvents.js";

/**
 * Push-notification rules: which items a reminder slot covers and what the notification says.
 *
 * Only the server schedules notifications, but the rules live here because they must agree with
 * the home "What's on" widget — an item that shows there as "Today" is exactly an item the 9am
 * notification names. They are built from the same qualification rules the widget uses.
 */

export type NotificationSlot = "morning" | "week_ahead" | "evening";

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
}

/** In send order: slots sharing a start time are merged into one notification, in this order. */
export const NOTIFICATION_SLOTS: readonly NotificationSlotConfig[] = [
  { slot: "morning", heading: "Today", startMinute: 9 * 60, endMinute: 12 * 60, dayOffset: 0, birthdaysOnly: false },
  { slot: "week_ahead", heading: "In a week", startMinute: 9 * 60, endMinute: 12 * 60, dayOffset: 7, birthdaysOnly: true },
  { slot: "evening", heading: "Tomorrow", startMinute: 21 * 60, endMinute: 24 * 60, dayOffset: 1, birthdaysOnly: false },
];

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
 * Ordered by name, then notes before logs, then id.
 */
export function itemsOccurringOn(
  noteRows: Iterable<ImportantDateNoteRow>,
  eventRows: Iterable<UpcomingEventLogRow>,
  dateISO: string,
  { birthdaysOnly = false }: { birthdaysOnly?: boolean } = {},
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
      name: row.entityName,
      kind: 0,
      id: row.noteId,
    });
  }

  if (!birthdaysOnly) {
    for (const row of eventRows) {
      if (!EVENT_CATEGORIES.includes(row.category)) continue;
      if (row.date !== dateISO || !isPlannedAhead(row)) continue;
      const withWho =
        row.people.length > 0 ? ` with ${row.people.map((p) => p.name).join(", ")}` : "";
      items.push({
        key: `log:${row.logId}`,
        label: `${row.entityTitle}${withWho}`,
        name: row.entityTitle,
        kind: 1,
        id: row.logId,
      });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name) || a.kind - b.kind || a.id - b.id);
  return items.map(({ key, label }) => ({ key, label }));
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
