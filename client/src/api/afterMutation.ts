import type { QueryClient } from "@tanstack/react-query";
import { pullChanges } from "../sync/pull.js";

/**
 * Run after a successful write. Mutations still go straight to the server (the lite tier has
 * no offline write queue); this pulls the resulting change into the local replica and then
 * invalidates every query so the UI re-reads from IndexedDB. If the pull fails we still
 * invalidate — the local copy is the source of truth for reads regardless.
 */
export function refreshAfterMutation(queryClient: QueryClient): Promise<void> {
  const invalidate = () => {
    void queryClient.invalidateQueries();
  };
  return pullChanges().then(invalidate, invalidate);
}
