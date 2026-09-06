/**
 * Grid and label helpers for the calendar screen. Dates are `YYYY-MM-DD`, months are `YYYY-MM`.
 * Everything goes through `Date.UTC` so there's no local-timezone drift.
 *
 * The underlying date arithmetic lives in `@logger/shared/dates`, shared with the server. Only
 * the presentation-side helpers — the month grid, the labels, the weekday headers — are here.
 * `daysInMonth` and `addMonths` are re-exported so the calendar screen has one import.
 */
import { addMonths, daysInMonth } from "@logger/shared";

export { addMonths, daysInMonth };

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
