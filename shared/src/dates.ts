/**
 * UTC, day-granularity date helpers. Dates are `YYYY-MM-DD` strings and months are `YYYY-MM`.
 *
 * Everything goes through `Date.UTC` so there is no local-timezone drift. This lives in
 * `shared` because the server services and the offline client's query layer must agree
 * exactly on what "today", "the next annual occurrence" and "a day that exists" mean — they
 * previously kept separate copies of these functions and could have drifted apart silently.
 */

/** ISO `YYYY-MM-DD` string for a Date. */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The given instant truncated to midnight UTC. */
export function atMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Zero-pad a month or day to two digits. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Number of days in a given month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days between two `YYYY-MM-DD` strings (`to - from`), UTC. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** A new Date `days` after `d`, at midnight UTC. */
export function addDaysUTC(d: Date, days: number): Date {
  const next = atMidnightUTC(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Shift a `YYYY-MM` month by `delta` months, rolling the year. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

/**
 * The next annual occurrence (by month+day) of `eventDate` on or after `today`.
 *
 * Note this rolls Feb 29 to Mar 1 in a non-leap year, because the candidate is built through
 * `Date.UTC`, which normalises an out-of-range day forward. The calendar range placement
 * deliberately does NOT do that — it skips a day that does not exist in the target year —
 * so the two are not interchangeable. See `rules/calendar.ts`.
 */
export function nextAnnualOccurrence(eventDate: string, today: Date): Date {
  const [, month, day] = eventDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
  if (candidate.getTime() < today.getTime()) {
    return new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
  }
  return candidate;
}
