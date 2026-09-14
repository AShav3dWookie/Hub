/**
 * Wall-clock time in a named IANA time zone.
 *
 * The container's clock is UTC, but "9pm the day before" means 9pm where the user lives, BST or
 * GMT. `Intl` carries the zone rules (Node ships full ICU, so the Alpine image needs no tzdata),
 * which keeps daylight-saving arithmetic out of this codebase entirely.
 */

export interface LocalTime {
  /** The local calendar date, `YYYY-MM-DD`. */
  dateISO: string;
  /** Minutes since local midnight, 0–1439. */
  minutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The local date and time of `now` in `timeZone`. */
export function localTime(now: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Whether `timeZone` is a zone `Intl` recognises. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** A `YYYY-MM-DD` date shifted by whole days. Calendar arithmetic only — no zone involved. */
export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
