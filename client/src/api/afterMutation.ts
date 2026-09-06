import type { QueryClient } from "@tanstack/react-query";
import { runSync } from "../sync/engine.js";

/**
 * Run after a successful write.
 *
 * The write has already landed in the local replica and been queued in the outbox, so this
 * pushes the queue and pulls the server's answer back (if the sync policy allows a "mutation"
 * sync), then invalidates every query so the UI re-reads from IndexedDB.
 *
 * Invalidation happens whether the sync succeeded or failed. The replica is the source of
 * truth for reads, and the write is already in it, so a failed sync must still refresh the UI —
 * otherwise an offline write would appear not to have happened.
 */
export function refreshAfterMutation(queryClient: QueryClient): Promise<void> {
  const invalidate = () => {
    void queryClient.invalidateQueries();
  };
  return runSync("mutation").then(invalidate, invalidate);
}
