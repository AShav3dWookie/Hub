import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { runSync, nextScheduledSyncAt } from "./engine.js";
import type { SyncReason } from "./policy.js";

/**
 * Drives sync for the running app: pulls on open, on refocus, on reconnect, and re-arms a
 * timer for the next policy-scheduled time (local midnight by default). Every successful pull
 * invalidates queries so the UI re-reads the replica.
 *
 * `runSync`/`pullChanges` are single-flight, so overlapping triggers (StrictMode double
 * mount, focus + online firing together) collapse into one run.
 */
export function useSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fire = (reason: SyncReason) => {
      void runSync(reason)
        .then((result) => {
          if (result && !cancelled) void queryClient.invalidateQueries();
        })
        .catch(() => {
          // recorded in meta (lastSyncError); Settings surfaces it
        });
    };

    const arm = async () => {
      const next = await nextScheduledSyncAt();
      if (cancelled || next == null) return;
      const delay = Math.min(Math.max(next - Date.now(), 1_000), 2_147_483_647);
      timer = setTimeout(() => {
        fire("scheduled");
        void arm();
      }, delay);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") fire("focus");
    };
    const onOnline = () => fire("online");

    fire("open");
    void arm();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [queryClient]);
}
