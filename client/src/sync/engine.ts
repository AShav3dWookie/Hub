import { getMeta, META_LAST_SYNC_AT } from "../local/db.js";
import { pullChanges, type PullResult } from "./pull.js";
import { pushOutbox } from "./push.js";
import { defaultPolicy, type SyncContext, type SyncReason } from "./policy.js";

async function currentContext(): Promise<SyncContext> {
  return {
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    lastSyncAt: (await getMeta<number>(META_LAST_SYNC_AT)) ?? null,
    now: Date.now(),
  };
}

/**
 * Run a sync if the active policy allows it for this `reason`. `"manual"` always runs (and
 * lets the error surface). Queued offline writes are **pushed before the pull** so our own
 * changes reach the server before we read its state back. Returns the {@link PullResult}, or
 * `null` when the policy declined or the device is offline.
 */
export async function runSync(reason: SyncReason): Promise<PullResult | null> {
  const ctx = await currentContext();

  if (reason === "manual") {
    await pushOutbox().catch(() => {});
    return pullChanges();
  }
  if (!ctx.online) return null;
  if (!defaultPolicy().allows(reason, ctx)) return null;

  await pushOutbox().catch(() => {});
  return pullChanges();
}

/** Explicit user-triggered sync (Settings "Sync now"). Always attempts, surfaces failures. */
export async function forceSync(): Promise<PullResult> {
  await pushOutbox().catch(() => {});
  return pullChanges();
}

/** Epoch ms of the next time-scheduled sync, per the active policy. */
export async function nextScheduledSyncAt(): Promise<number | null> {
  return defaultPolicy().nextScheduledAt(await currentContext());
}
