/**
 * An optional time of day, as appointments carry it: local wall-clock `HH:MM` (24-hour), or
 * null for an untimed item. Shared by the server and the offline client so both validate, order
 * and compare times identically.
 */

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_OF_DAY_PATTERN.test(value);
}

/** Minutes after midnight: "15:30" → 930. */
export function minutesOfDay(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * Order within one day: untimed items first (they belong to the whole day), then by time.
 * `HH:MM` sorts correctly as a string.
 */
export function compareTimeOfDay(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0);
  return a.localeCompare(b);
}
