import type { QueryClient } from "@tanstack/react-query";
import { runSync } from "../sync/engine.js";

/**
 * Run after a successful write. Mutations still go straight to the server (the lite tier has
 * no offline write queue); this pulls the resulting change into the local replica (if the
 * sync policy allows a "mutation" sync) and then invalidates every query so the UI re-reads
 * from IndexedDB. If the pull fails or is skipped we still invalidate — the local copy is the
 * source of truth for reads regardless.
 */
export function refreshAfterMutation(queryClient: QueryClient): Promise<void> {
  const invalidate = () => {
    void queryClient.invalidateQueries();
  };
  return runSync("mutation").then(invalidate, invalidate);
}
