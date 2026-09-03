/**
 * Periodic Background Sync registration. Chrome-only, installed-PWA-only, and gated on a
 * site-engagement heuristic — so it's a best-effort enhancement on top of the baseline
 * (sync on open / focus / online + the daily in-app timer).
 */

export type PeriodicSyncStatus =
  | "active" // registered
  | "denied" // permission not granted
  | "unsupported" // API missing (iOS, not installed, Firefox…)
  | "error";

export const PERIODIC_SYNC_TAG = "logger-daily";
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

interface PeriodicSyncManager {
  register(tag: string, options?: { minInterval: number }): Promise<void>;
  getTags(): Promise<string[]>;
  unregister(tag: string): Promise<void>;
}

function managerOf(reg: ServiceWorkerRegistration): PeriodicSyncManager | null {
  return (reg as unknown as { periodicSync?: PeriodicSyncManager }).periodicSync ?? null;
}

async function permissionState(): Promise<PermissionState | "unsupported"> {
  if (!("permissions" in navigator)) return "unsupported";
  try {
    const status = await navigator.permissions.query({
      name: "periodic-background-sync" as PermissionName,
    });
    return status.state;
  } catch {
    return "unsupported";
  }
}

/** Register the daily periodic sync if the browser and permissions allow it. */
export async function registerPeriodicSync(): Promise<PeriodicSyncStatus> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const reg = await navigator.serviceWorker.ready;
  const manager = managerOf(reg);
  if (!manager) return "unsupported";

  if ((await permissionState()) !== "granted") return "denied";

  try {
    await manager.register(PERIODIC_SYNC_TAG, { minInterval: MIN_INTERVAL_MS });
    return "active";
  } catch {
    return "error";
  }
}

/** Current status without changing anything — for the Settings display. */
export async function periodicSyncStatus(): Promise<PeriodicSyncStatus> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration();
  const manager = reg ? managerOf(reg) : null;
  if (!manager) return "unsupported";

  const perm = await permissionState();
  if (perm === "unsupported") return "unsupported";
  if (perm !== "granted") return "denied";

  try {
    const tags = await manager.getTags();
    return tags.includes(PERIODIC_SYNC_TAG) ? "active" : "denied";
  } catch {
    return "error";
  }
}
