import { addDaysUTC, atMidnightUTC, toISODate } from "../dates.js";

/**
 * The "today / next 7 days" split used by both home-screen widgets. The same skeleton was
 * previously written out at four call sites across the server and the offline client.
 */

export interface WindowBuckets<T> {
  today: T[];
  next7Days: T[];
}

/**
 * Split `rows` into the ones landing today and the ones landing in the following `days`
 * (tomorrow through today+days, inclusive), discarding anything outside that window. Both
 * buckets are sorted with `compare`.
 *
 * Dates are compared as `YYYY-MM-DD` strings, whose lexicographic order is their chronological
 * order, so no row is ever round-tripped through `Date`.
 */
export function bucketByWindow<T>(
  rows: Iterable<T>,
  dateOf: (row: T) => string,
  today: Date,
  compare: (a: T, b: T) => number,
  days = 7,
): WindowBuckets<T> {
  const todayISO = toISODate(atMidnightUTC(today));
  const endISO = toISODate(addDaysUTC(today, days));

  const todayRows: T[] = [];
  const next7Days: T[] = [];

  for (const row of rows) {
    const date = dateOf(row);
    if (date === todayISO) todayRows.push(row);
    else if (date > todayISO && date <= endISO) next7Days.push(row);
  }

  todayRows.sort(compare);
  next7Days.sort(compare);
  return { today: todayRows, next7Days };
}
