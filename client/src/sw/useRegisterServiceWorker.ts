import { useEffect } from "react";
import { useToast } from "../components/ToastProvider.js";
import { registerServiceWorker } from "./register.js";
import { registerPeriodicSync } from "./periodicSync.js";

/**
 * Registers the service worker on mount (production only), wiring its notices to toasts, and
 * best-effort-registers the daily Periodic Background Sync.
 */
export function useRegisterServiceWorker(): void {
  const { showToast } = useToast();
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    registerServiceWorker(showToast);
    void registerPeriodicSync();
  }, [showToast]);
}
