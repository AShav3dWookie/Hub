import { getDB, META_OUTBOX_SEQ, META_TEMP_ID_SEQ, type MetaRecord } from "./db.js";

/**
 * The two monotonic counters the writes tier needs, minted from `meta`:
 *
 *   - **temp ids** — negative placeholders (`-1, -2, …`) for rows the server hasn't seen. Server
 *     autoincrement ids are always positive, so a negative id can never collide with a real one.
 *   - **outbox seq** — ascending queue order (`1, 2, …`); the server replays a batch in seq order.
 *
 * Each mint is a single read-modify-write inside one `readwrite` transaction, so concurrent
 * callers (rapid form submits, a second tab) always get distinct values.
 *
 * `applyLocalMutation` does its own counter bumps inside its one big transaction — these
 * standalone helpers are for callers that touch nothing else.
 */

type MetaStore = {
  get(key: string): Promise<MetaRecord | undefined>;
  put(value: MetaRecord): Promise<unknown>;
};

/** Read `key` (default 0), add `delta`, write it back, return the new value. */
export async function bumpCounter(store: MetaStore, key: string, delta: number): Promise<number> {
  const current = ((await store.get(key))?.value as number | undefined) ?? 0;
  const next = current + delta;
  await store.put({ key, value: next });
  return next;
}

export async function mintTempId(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction("meta", "readwrite");
  const id = await bumpCounter(tx.objectStore("meta"), META_TEMP_ID_SEQ, -1);
  await tx.done;
  return id;
}

export async function mintOutboxSeq(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction("meta", "readwrite");
  const seq = await bumpCounter(tx.objectStore("meta"), META_OUTBOX_SEQ, 1);
  await tx.done;
  return seq;
}
