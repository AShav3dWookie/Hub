import { useEffect } from "react";
import { useToast } from "../components/ToastProvider.js";
import { registerServiceWorker } from "./register.js";
import { registerPeriodicSync } from "./periodicSync.js";
import { refreshPushSubscription } from "./push.js";
import { ensureCurrentShell } from "./shellVersion.js";

/**
 * Registers the service worker on mount (production only), wiring its notices to toasts,
 * best-effort-registers the daily Periodic Background Sync, and re-sends this device's push
 * subscription so the server still has it.
 *
 * `ensureCurrentShell` runs first and may reload the page: if the bundle is older than what the
 * server serves, nothing else here is worth doing until that is fixed.
 */
export function useRegisterServiceWorker(): void {
  const { showToast } = useToast();
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    void ensureCurrentShell();
    registerServiceWorker(showToast);
    void registerPeriodicSync();
    void refreshPushSubscription();
  }, [showToast]);
}
