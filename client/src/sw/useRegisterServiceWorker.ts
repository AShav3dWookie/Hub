import { useEffect } from "react";
import { useToast } from "../components/ToastProvider.js";
import { registerServiceWorker } from "./register.js";

/** Registers the service worker on mount (production only), wiring its notices to toasts. */
export function useRegisterServiceWorker(): void {
  const { showToast } = useToast();
  useEffect(() => {
    registerServiceWorker(showToast);
  }, [showToast]);
}
