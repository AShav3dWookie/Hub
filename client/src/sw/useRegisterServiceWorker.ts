import { useEffect } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useToast } from "../components/ToastProvider.js";
import { useUnsavedChanges } from "../lib/unsavedChanges.js";
import { registerServiceWorker } from "./register.js";
import { registerPeriodicSync } from "./periodicSync.js";
import { refreshPushSubscription } from "./push.js";
import { startAppUpdates } from "./appUpdate.js";

/**
 * Registers the service worker on mount (production only), wiring its notices to toasts,
 * best-effort-registers the daily Periodic Background Sync, and re-sends this device's push
 * subscription so the server still has it.
 *
 * `startAppUpdates` runs first and may reload the page: if the bundle is older than what the
 * server serves, nothing else here is worth doing until that is fixed. It keeps checking each
 * time the app returns to the foreground.
 */
export function useRegisterServiceWorker(): void {
  const { showToast } = useToast();
  // A write or an upload still in flight is unsaved work too: a reload would cut it off.
  useUnsavedChanges(useIsMutating() > 0);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const updates = startAppUpdates({ showToast });
    registerServiceWorker(showToast, updates.workerUpdated);
    void registerPeriodicSync();
    void refreshPushSubscription();
    return updates.stop;
  }, [showToast]);
}
