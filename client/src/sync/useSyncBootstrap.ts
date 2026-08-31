import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pullChanges } from "./pull.js";

/**
 * Kicks off a sync pull on mount and refreshes every query once it lands, so a freshly
 * opened app converges on server state without any screen having waited on the network.
 * `pullChanges` is single-flight, so React StrictMode's double-invoke is harmless.
 *
 * Scheduling (daily 00:00, on-visibility, on-online) is added in a later branch; this is just
 * the open-the-app trigger.
 */
export function useSyncBootstrap(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    void pullChanges()
      .then(() => {
        if (!cancelled) void queryClient.invalidateQueries();
      })
      .catch(() => {
        // The failure is recorded in meta (lastSyncError); the Settings screen surfaces it.
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);
}
