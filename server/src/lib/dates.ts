/** Shared date helpers for the home-screen "upcoming" widgets (UTC, day-granularity). */

/** ISO YYYY-MM-DD string for a Date. */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The given instant truncated to midnight UTC. */
export function atMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
