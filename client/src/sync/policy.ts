/**
 * Pluggable sync scheduling. The lite tier ships `defaultPolicy()` — sync on open, on focus,
 * on reconnect, and once a day at local midnight — but the shape here is meant to grow:
 * wifi-only, immediate-on-change, "not more than every N minutes", etc.
 */

export type SyncReason = "open" | "focus" | "online" | "scheduled" | "manual" | "mutation";

export interface SyncContext {
  online: boolean;
  lastSyncAt: number | null;
  now: number;
}

export interface SyncPolicy {
  /** May a sync run now for this reason? (`"manual"` bypasses policy entirely — see the engine.) */
  allows(reason: SyncReason, ctx: SyncContext): boolean;
  /** Epoch ms of the next time-scheduled sync, or `null` if this policy doesn't schedule one. */
  nextScheduledAt(ctx: SyncContext): number | null;
}

/** Only ever syncs on an explicit user request. */
export class ManualOnlyPolicy implements SyncPolicy {
  allows(reason: SyncReason, _ctx: SyncContext): boolean {
    return reason === "manual";
  }
  nextScheduledAt(_ctx: SyncContext): number | null {
    return null;
  }
}

/** Sync whenever the app is opened / refocused / reconnects, or right after a write. */
export class OnOpenPolicy implements SyncPolicy {
  allows(reason: SyncReason, ctx: SyncContext): boolean {
    if (!ctx.online) return false;
    return reason === "open" || reason === "focus" || reason === "online" || reason === "mutation";
  }
  nextScheduledAt(_ctx: SyncContext): number | null {
    return null;
  }
}

/** Sync once a day at local midnight. */
export class DailyMidnightPolicy implements SyncPolicy {
  allows(reason: SyncReason, ctx: SyncContext): boolean {
    return reason === "scheduled" && ctx.online;
  }
  nextScheduledAt(ctx: SyncContext): number | null {
    const d = new Date(ctx.now);
    d.setHours(24, 0, 0, 0); // next local 00:00
    return d.getTime();
  }
}

/**
 * Only sync on unmetered connections. Stub — `navigator.connection` support and the metered
 * flag land with the writes tier; for now it behaves like {@link OnOpenPolicy}.
 */
export class WifiOnlyPolicy extends OnOpenPolicy {}

/** Sync on every change as soon as it happens. Stub for the writes tier. */
export class ImmediatePolicy extends OnOpenPolicy {
  override allows(reason: SyncReason, ctx: SyncContext): boolean {
    return ctx.online && reason !== "scheduled";
  }
}

/** OR of `allows`, earliest of `nextScheduledAt`. */
export class CompositePolicy implements SyncPolicy {
  constructor(private readonly policies: SyncPolicy[]) {}
  allows(reason: SyncReason, ctx: SyncContext): boolean {
    return this.policies.some((p) => p.allows(reason, ctx));
  }
  nextScheduledAt(ctx: SyncContext): number | null {
    const times = this.policies
      .map((p) => p.nextScheduledAt(ctx))
      .filter((t): t is number => t != null);
    return times.length > 0 ? Math.min(...times) : null;
  }
}

let active: SyncPolicy = new CompositePolicy([new OnOpenPolicy(), new DailyMidnightPolicy()]);

/** The policy the engine consults. Swappable so a future Settings screen can change it. */
export function defaultPolicy(): SyncPolicy {
  return active;
}

/** Test / settings hook to replace the active policy. */
export function setPolicy(policy: SyncPolicy): void {
  active = policy;
}
