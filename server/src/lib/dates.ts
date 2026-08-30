/** Shared date helpers (UTC, day-granularity). Dates are `YYYY-MM-DD` strings. */

/** ISO YYYY-MM-DD string for a Date. */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The given instant truncated to midnight UTC. */
export function atMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Number of days in a given month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days between two `YYYY-MM-DD` strings (`to - from`), UTC. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}
