/**
 * Apply a change to one end of a date range, auto-filling the other end when it is
 * still blank. Lets you pick a single day for a range "a few months out" without
 * navigating the calendar twice. Never overwrites an end you've already set, and
 * clearing a field leaves its counterpart alone.
 */
export function updateDateRange(
  edited: "start" | "end",
  value: string,
  current: { start: string; end: string },
): { start: string; end: string } {
  if (edited === "start") {
    return { start: value, end: current.end || value };
  }
  return { start: current.start || value, end: value };
}
