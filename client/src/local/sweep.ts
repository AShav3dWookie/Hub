import type { EntitySyncDTO, LogSyncDTO } from "@logger/shared";

/** UTC `YYYY-MM-DD` for an instant (matches the server's `toISODate(atMidnightUTC(...))`). */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Ids of expired auto-delete appointment logs — the client mirror of the server's
 * `sweepExpiredAppointments`. An appointment log flagged `autoDelete` whose date is strictly
 * before today is treated as gone: the repo hides it from every read until the server's
 * tombstone arrives and the sync engine deletes it for real.
 */
export function expiredAppointmentLogIds(
  logs: LogSyncDTO[],
  entityById: Map<number, EntitySyncDTO>,
  now: Date = new Date(),
): Set<number> {
  const cutoff = todayISO(now);
  const expired = new Set<number>();
  for (const log of logs) {
    if (!log.autoDelete) continue;
    if (log.date >= cutoff) continue;
    if (entityById.get(log.entityId)?.category === "appointment") expired.add(log.id);
  }
  return expired;
}
