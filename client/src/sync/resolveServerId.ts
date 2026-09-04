import { pushOutbox } from "./push.js";
import { resolvedRealId } from "./reconcile.js";

/**
 * The real server id for a record that may have only just been created locally.
 *
 * A create goes through the outbox and hands back a temporary negative id. Media has no offline
 * queue and the photo routes reject a temp id, so anything wanting to attach media has to wait
 * for the record to reach the server and learn what id it was given.
 *
 * The outbox is flushed here rather than relying on the sync that a write kicks off: that one
 * runs under the sync policy and may legitimately decide to skip, which would leave the id
 * unresolved and the media quietly dropped. `pushOutbox` is single-flight, so if the automatic
 * push is already running this waits on that same attempt instead of starting a second one.
 *
 * Throws when the id cannot be resolved — offline, or the push failed. Callers should treat
 * that as "saved, but the media did not attach".
 */
export async function resolveServerId(localId: number): Promise<number> {
  if (localId > 0) return localId;

  const alreadyKnown = resolvedRealId(localId);
  if (alreadyKnown != null) return alreadyKnown;

  await pushOutbox();

  const resolved = resolvedRealId(localId);
  if (resolved == null) {
    throw new Error("The record has not reached the server yet, so media cannot be attached.");
  }
  return resolved;
}
