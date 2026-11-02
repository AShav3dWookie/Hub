import { registerSW } from "virtual:pwa-register";

/**
 * Register the service worker (production only). `autoUpdate` means a new build activates on
 * its own; `onNeedReload` is called when it has, instead of the plugin reloading the page
 * itself, so the reload can wait for a safe moment (see `appUpdate.ts`).
 */
export function registerServiceWorker(
  showToast?: (message: string) => void,
  onNeedReload?: () => void,
): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  registerSW({
    immediate: true,
    onNeedReload,
    onOfflineReady() {
      showToast?.("Ready to use offline");
    },
    onNeedRefresh() {
      showToast?.("Update available — reload to get the latest");
    },
  });
}
