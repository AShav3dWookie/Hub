import { useEffect } from "react";

/**
 * Which parts of the screen hold input a reload would throw away.
 *
 * The app reloads itself onto a new build when one is deployed (`sw/appUpdate.ts`), and on a
 * phone that can happen the moment it comes back to the foreground. A form someone was halfway
 * through must not vanish under them, so every form that keeps its own draft says so here, and
 * the reload waits until nothing does.
 *
 * Each caller holds its own token, so two dirty forms on one screen are two holders, and one of
 * them saving does not clear the other.
 */
const holders = new Set<object>();

/** True while any mounted form holds a draft. */
export function hasUnsavedChanges(): boolean {
  return holders.size > 0;
}

/** Mark this component as holding unsaved input for as long as `dirty` is true. */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const token = {};
    holders.add(token);
    return () => {
      holders.delete(token);
    };
  }, [dirty]);
}
