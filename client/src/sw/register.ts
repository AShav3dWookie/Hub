import { registerSW } from "virtual:pwa-register";

/**
 * Register the service worker (production only). `autoUpdate` means a new build activates on
 * the next full load regardless; the toasts are just courtesy notices.
 */
export function registerServiceWorker(showToast?: (message: string) => void): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  registerSW({
    immediate: true,
    onOfflineReady() {
      showToast?.("Ready to use offline");
    },
    onNeedRefresh() {
      showToast?.("Update available — reload to get the latest");
    },
  });
}
