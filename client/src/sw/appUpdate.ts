import type { ToastOptions } from "../components/ToastProvider.js";
import { hasUnsavedChanges } from "../lib/unsavedChanges.js";
import { builtVersion, newerServingVersion, updateShell } from "./shellVersion.js";

/**
 * When the running app moves onto a newly deployed build.
 *
 * Checking only at launch is not enough: on Android an installed app is resumed far more often
 * than it is relaunched, so a phone could sit on an old build for days while a private window
 * showed the new one. So the check also runs whenever the app comes back to the foreground, at
 * most once per {@link RESUME_CHECK_INTERVAL_MS} so flicking between apps doesn't hammer
 * `/api/health`.
 *
 * Moving means a reload, and a reload throws away whatever is typed into a form. So it happens
 * straight away only when nothing would be lost; otherwise a toast offers the update, and it is
 * offered again on each return to the foreground until it can go ahead.
 *
 * The worker's own update path goes through here too. With `registerType: "autoUpdate"` the
 * plugin reloads the page the moment a new worker activates — which a background update check
 * (a push, a periodic sync) can trigger in the middle of a form — unless it is given
 * `onNeedReload`, which is {@link AppUpdates.workerUpdated}.
 *
 * Offline is quiet, as before: no server means no check, and nothing here touches IndexedDB.
 */

/** The least time between two resume checks. A launch always checks. */
export const RESUME_CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * How long after coming back to wait before deciding. Returning from the photo picker is a
 * return to the foreground too, and the picked files arrive just after it; deciding at once
 * could reload the form before they land in it.
 */
export const RESUME_SETTLE_MS = 1_500;

/** The version being left, so the next load can say what it moved to. */
const UPDATING_FROM_KEY = "logger:updating-from";

export interface AppUpdateDeps {
  showToast: (message: string, options?: ToastOptions) => void;
  /** Injected so a test can observe the reload instead of navigating. */
  reload?: () => void;
  now?: () => number;
}

export interface AppUpdates {
  /** A new worker has activated by itself, so a plain reload picks up its build. */
  workerUpdated: () => void;
  stop: () => void;
}

/** Someone is typing, or has a picker open: the focused element is a field. */
function fieldHasFocus(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  return (
    el instanceof HTMLInputElement &&
    !["button", "submit", "reset", "checkbox", "radio"].includes(el.type)
  );
}

function isSafeToReload(): boolean {
  return !hasUnsavedChanges() && !fieldHasFocus();
}

/** Read and clear the version an update reload left. */
function takeUpdatingFrom(): string | null {
  try {
    const from = sessionStorage.getItem(UPDATING_FROM_KEY);
    sessionStorage.removeItem(UPDATING_FROM_KEY);
    return from;
  } catch {
    return null;
  }
}

function writeUpdatingFrom(version: string | null): void {
  try {
    if (version === null) sessionStorage.removeItem(UPDATING_FROM_KEY);
    else sessionStorage.setItem(UPDATING_FROM_KEY, version);
  } catch {
    // Storage disabled. Losing it costs the "Updated" toast, nothing else.
  }
}

/** After an update reload, say so — otherwise the flash is a mystery. */
function announceCompletedUpdate(showToast: AppUpdateDeps["showToast"]): void {
  const from = takeUpdatingFrom();
  const built = builtVersion();
  if (from && built && from !== built) showToast(`Updated to ${built}`);
}

export function startAppUpdates(deps: AppUpdateDeps): AppUpdates {
  const reload = deps.reload ?? (() => location.reload());
  const now = deps.now ?? Date.now;

  let lastCheckAt = -Infinity;
  /** A newer build is waiting. `viaWorker`: the worker already has it, so just reload. */
  let pending: { version?: string; viaWorker: boolean } | null = null;
  let applying = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  async function apply(): Promise<void> {
    if (applying || !pending) return;
    applying = true;
    writeUpdatingFrom(builtVersion() ?? null);

    if (pending.viaWorker) {
      reload();
      return;
    }
    if (!(await updateShell({ reload }))) {
      // Two attempts already failed this session; stop offering one that cannot work.
      writeUpdatingFrom(null);
      pending = null;
      applying = false;
    }
  }

  function offer(): void {
    if (!pending || applying) return;
    if (isSafeToReload()) {
      void apply();
      return;
    }
    const ready = pending.version ? `Hub ${pending.version} is ready` : "A new Hub is ready";
    deps.showToast(`${ready} — tap to update`, { onTap: () => void apply(), persist: true });
  }

  async function check(): Promise<void> {
    lastCheckAt = now();
    const serving = await newerServingVersion();
    if (!serving || pending) return;
    pending = { version: serving, viaWorker: false };
    offer();
  }

  function onResume(): void {
    if (pending) offer();
    else if (now() - lastCheckAt >= RESUME_CHECK_INTERVAL_MS) void check();
  }

  const onVisibilityChange = () => {
    clearTimeout(settleTimer);
    if (document.visibilityState === "visible") settleTimer = setTimeout(onResume, RESUME_SETTLE_MS);
  };

  announceCompletedUpdate(deps.showToast);
  document.addEventListener("visibilitychange", onVisibilityChange);
  void check();

  return {
    workerUpdated() {
      if (applying) return; // our own update activated it; the reload is already coming
      pending = { version: pending?.version, viaWorker: true };
      // In the background, leave it for the return to the foreground to offer.
      if (document.visibilityState === "visible") offer();
    },
    stop() {
      clearTimeout(settleTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
