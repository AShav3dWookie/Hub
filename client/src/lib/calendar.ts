/**
 * Pure UTC month math for the calendar screen. Dates are `YYYY-MM-DD`, months are `YYYY-MM`.
 * Everything goes through `Date.UTC` so there's no local-timezone drift (matches the server's
 * `lib/dates.ts` and the UTC formatting in `EntityNotes.tsx`).
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days in a month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Shift a `YYYY-MM` month by `delta` months, rolling the year. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

/** "August 2026" for a `YYYY-MM`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Monday 25 August 2024" for a `YYYY-MM-DD`. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface GridCell {
  date: string;
  inMonth: boolean;
}

/**
 * The Monday-first grid for a month: leading days from the previous month to fill the first week,
 * then the month, then trailing days to complete the last week. Every cell is a real date.
 */
export function monthGrid(month: string): GridCell[] {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7; // Mon = 0
  const inMonthCount = daysInMonth(year, m);
  const rows = Math.ceil((leading + inMonthCount) / 7);

  const cells: GridCell[] = [];
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - leading);
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({ date: iso, inMonth: iso.slice(0, 7) === month });
  }
  return cells;
}

/** The [from, to] inclusive date range covered by a month's grid. */
export function gridRange(month: string): { from: string; to: string } {
  const cells = monthGrid(month);
  return { from: cells[0].date, to: cells[cells.length - 1].date };
}

/** Weekday column headers, Monday first. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
