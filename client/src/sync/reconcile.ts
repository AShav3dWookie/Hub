import { getDB, SYNC_STORES } from "../local/db.js";
import { deepRemapIds } from "../local/outbox.js";

/**
 * Fold the server's `tempId → realId` answers (from a `POST /api/sync/mutations` batch) back
 * into the local replica, in one transaction:
 *
 *  1. **Re-key** every temp row (`id < 0`) the server gave a real id. If a row with that real
 *     id already exists — the server deduped our offline "Chipotle" onto one it already had —
 *     the temp row is dropped, not written over. Two temp rows that map to the same real id
 *     converge on it.
 *  2. **Rewrite foreign keys** everywhere a re-keyed id could be referenced
 *     (`logs.entityId` / `peopleIds` / `albumIds`, `albums.eventLogIds` / `personIds`,
 *     `entityNotes.entityId`), de-duping arrays that collapse.
 *  3. **Rewrite still-pending outbox envelopes** so a later queued mutation that referenced an
 *     earlier create now points at the real id.
 */
export async function reconcileIds(map: Map<number, number>): Promise<void> {
  if (map.size === 0) return;
  const db = await getDB();
  const tx = db.transaction([...SYNC_STORES, "outbox"], "readwrite");

  const remap = (id: number) => map.get(id) ?? id;
  const remapArr = (ids: number[]) => {
    const out: number[] = [];
    for (const id of ids) {
      const r = remap(id);
      if (!out.includes(r)) out.push(r);
    }
    return out;
  };
  const sameArr = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

  // 1. Re-key temp rows.
  for (const store of SYNC_STORES) {
    const os = tx.objectStore(store);
    for (const row of await os.getAll()) {
      const target = map.get(row.id);
      if (target == null) continue;
      await os.delete(row.id);
      if (!(await os.get(target))) await os.put({ ...row, id: target });
    }
  }

  // 2. Rewrite foreign keys.
  const logs = tx.objectStore("logs");
  for (const log of await logs.getAll()) {
    const next = {
      ...log,
      entityId: remap(log.entityId),
      peopleIds: remapArr(log.peopleIds),
      albumIds: remapArr(log.albumIds),
    };
    if (
      next.entityId !== log.entityId ||
      !sameArr(next.peopleIds, log.peopleIds) ||
      !sameArr(next.albumIds, log.albumIds)
    ) {
      await logs.put(next);
    }
  }

  const albums = tx.objectStore("albums");
  for (const album of await albums.getAll()) {
    const next = {
      ...album,
      eventLogIds: remapArr(album.eventLogIds),
      personIds: remapArr(album.personIds),
    };
    if (!sameArr(next.eventLogIds, album.eventLogIds) || !sameArr(next.personIds, album.personIds)) {
      await albums.put(next);
    }
  }

  const notes = tx.objectStore("entityNotes");
  for (const note of await notes.getAll()) {
    const entityId = remap(note.entityId);
    if (entityId !== note.entityId) await notes.put({ ...note, entityId });
  }

  // 3. Rewrite still-pending envelopes.
  const outbox = tx.objectStore("outbox");
  for (const rec of await outbox.getAll()) {
    if (rec.status !== "pending") continue;
    const payload = deepRemapIds(rec.payload, map);
    const tempId = rec.tempId != null ? remap(rec.tempId) : rec.tempId;
    const affects = rec.affects.map((a) => ({ ...a, id: remap(a.id) }));
    await outbox.put({ ...rec, payload, tempId, affects });
  }

  await tx.done;
}
