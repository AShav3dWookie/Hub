import type { SyncChangesResponse, SyncEntityType } from "@logger/shared";
import { getDB, META_SYNC_CURSOR, type SyncStore } from "../local/db.js";

const STORE_FOR: Record<SyncEntityType, SyncStore> = {
  entity: "entities",
  log: "logs",
  log_photo: "photos",
  album: "albums",
  entity_note: "entityNotes",
  list: "lists",
  list_item: "listItems",
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
    (c.lists?.length ?? 0) +
    (c.listItems?.length ?? 0) +
    resp.deletions.length
  );
}

/**
 * Apply one change-feed page to the local replica in a single transaction: upsert every row,
 * delete every tombstoned row, then advance the stored cursor. All-or-nothing so a failed
 * write never leaves the cursor ahead of the data.
 *
 * **Dirty guard (writes tier):** a row the user has changed locally but not yet pushed
 * (`_localDirty`) or soft-deleted (`_localDeleted`) is left alone — the incoming server copy
 * is skipped, not written over, and a tombstone for it is ignored. Once its outbox envelope
 * flushes, `reconcile` / `finalizeLocalRows` clears the flag and the next pull lands normally.
 */
export async function applyChanges(resp: SyncChangesResponse): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["entities", "logs", "photos", "albums", "entityNotes", "lists", "listItems", "meta"],
    "readwrite",
  );

  // A server older than lists sends no list arrays; treat that as nothing changed.
  const { entities, logs, photos, albums, entityNotes, lists = [], listItems = [] } = resp.changes;

  /** Has the user touched this row locally? Then the server copy must not clobber it. */
  const isDirty = (row?: { _localDirty?: boolean; _localDeleted?: boolean }) =>
    Boolean(row?._localDirty || row?._localDeleted);

  for (const row of entities) {
    if (!isDirty(await tx.objectStore("entities").get(row.id))) await tx.objectStore("entities").put(row);
  }
  for (const row of logs) {
    if (!isDirty(await tx.objectStore("logs").get(row.id))) await tx.objectStore("logs").put(row);
  }
  for (const row of photos) {
    if (!isDirty(await tx.objectStore("photos").get(row.id))) await tx.objectStore("photos").put(row);
  }
  for (const row of albums) {
    if (!isDirty(await tx.objectStore("albums").get(row.id))) await tx.objectStore("albums").put(row);
  }
  for (const row of entityNotes) {
    if (!isDirty(await tx.objectStore("entityNotes").get(row.id)))
      await tx.objectStore("entityNotes").put(row);
  }
  for (const row of lists) {
    if (!isDirty(await tx.objectStore("lists").get(row.id))) await tx.objectStore("lists").put(row);
  }
  for (const row of listItems) {
    if (!isDirty(await tx.objectStore("listItems").get(row.id)))
      await tx.objectStore("listItems").put(row);
  }

  for (const t of resp.deletions) {
    const store = STORE_FOR[t.entityType];
    if (!isDirty(await tx.objectStore(store).get(t.id))) await tx.objectStore(store).delete(t.id);
  }

  await tx.objectStore("meta").put({ key: META_SYNC_CURSOR, value: resp.nextCursor });
  await tx.done;
}
