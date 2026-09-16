import { useEffect } from "react";
import { useToast } from "../components/ToastProvider.js";
import { registerServiceWorker } from "./register.js";
import { registerPeriodicSync } from "./periodicSync.js";
import { refreshPushSubscription } from "./push.js";

/**
 * Registers the service worker on mount (production only), wiring its notices to toasts,
 * best-effort-registers the daily Periodic Background Sync, and re-sends this device's push
 * subscription so the server still has it.
 */
export function useRegisterServiceWorker(): void {
  const { showToast } = useToast();
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    registerServiceWorker(showToast);
    void registerPeriodicSync();
    void refreshPushSubscription();
  }, [showToast]);
}
