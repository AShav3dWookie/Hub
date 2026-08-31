import type { SyncChangesResponse, SyncEntityType } from "@logger/shared";
import { getDB, META_SYNC_CURSOR, type SyncStore } from "../local/db.js";

const STORE_FOR: Record<SyncEntityType, SyncStore> = {
  entity: "entities",
  log: "logs",
  log_photo: "photos",
  album: "albums",
  entity_note: "entityNotes",
};

/** Number of rows (upserts + deletions) a page carries — for progress reporting. */
export function countChanges(resp: SyncChangesResponse): number {
  const c = resp.changes;
  return (
    c.entities.length +
    c.logs.length +
    c.photos.length +
    c.albums.length +
    c.entityNotes.length +
    resp.deletions.length
  );
}

/**
 * Apply one change-feed page to the local replica in a single transaction: upsert every row,
 * delete every tombstoned row, then advance the stored cursor. All-or-nothing so a failed
 * write never leaves the cursor ahead of the data.
 *
 * The lite tier has no local writes, so incoming rows always win — no dirty/version guard.
 */
export async function applyChanges(resp: SyncChangesResponse): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["entities", "logs", "photos", "albums", "entityNotes", "meta"],
    "readwrite",
  );

  const { entities, logs, photos, albums, entityNotes } = resp.changes;
  const writes: Promise<unknown>[] = [
    ...entities.map((r) => tx.objectStore("entities").put(r)),
    ...logs.map((r) => tx.objectStore("logs").put(r)),
    ...photos.map((r) => tx.objectStore("photos").put(r)),
    ...albums.map((r) => tx.objectStore("albums").put(r)),
    ...entityNotes.map((r) => tx.objectStore("entityNotes").put(r)),
    ...resp.deletions.map((t) => tx.objectStore(STORE_FOR[t.entityType]).delete(t.id)),
    tx.objectStore("meta").put({ key: META_SYNC_CURSOR, value: resp.nextCursor }),
  ];

  await Promise.all(writes);
  await tx.done;
}
