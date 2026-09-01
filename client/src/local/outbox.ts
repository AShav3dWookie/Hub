import { getDB, type OutboxRecord } from "./db.js";

/**
 * CRUD + lifecycle helpers for the offline mutation queue. `applyLocalMutation` enqueues into
 * it inside its own transaction; the sync push drains it; Settings reads the counts.
 *
 * Ordering is always by `seq` (the `by-seq` index) — the server replays a batch in that order
 * so intra-batch temp-id references resolve.
 */

export async function listOutbox(): Promise<OutboxRecord[]> {
  return (await getDB()).getAllFromIndex("outbox", "by-seq");
}

export async function pendingOutbox(): Promise<OutboxRecord[]> {
  return (await listOutbox()).filter((r) => r.status === "pending");
}

export async function deadLetters(): Promise<OutboxRecord[]> {
  return (await listOutbox()).filter((r) => r.status === "dead");
}

export async function getOutbox(id: string): Promise<OutboxRecord | undefined> {
  return (await getDB()).get("outbox", id);
}

export async function removeOutbox(id: string): Promise<void> {
  await (await getDB()).delete("outbox", id);
}

export async function countPending(): Promise<number> {
  return (await pendingOutbox()).length;
}

async function patch(id: string, fn: (rec: OutboxRecord) => void): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("outbox", "readwrite");
  const rec = await tx.store.get(id);
  if (rec) {
    fn(rec);
    await tx.store.put(rec);
  }
  await tx.done;
}

/** Bump the retry counter before a push attempt. */
export function markAttempt(id: string): Promise<void> {
  return patch(id, (rec) => {
    rec.attempts += 1;
  });
}

/** Move an envelope the server rejected to the dead-letter state (kept for the user to discard). */
export function markDeadLetter(id: string, error: string): Promise<void> {
  return patch(id, (rec) => {
    rec.status = "dead";
    rec.error = error;
  });
}

/** Drop every dead-lettered envelope. Returns how many were removed. */
export async function discardDeadLetters(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction("outbox", "readwrite");
  let removed = 0;
  for (const rec of await tx.store.getAll()) {
    if (rec.status === "dead") {
      await tx.store.delete(rec.mutationId);
      removed += 1;
    }
  }
  await tx.done;
  return removed;
}

/** Deep-replace every negative id that appears as a key in `map` — in a payload, tempId, affects. */
function rewriteValue(value: unknown, map: Map<number, number>): unknown {
  if (typeof value === "number") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => rewriteValue(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, rewriteValue(v, map)]),
    );
  }
  return value;
}

/**
 * After reconciliation, rewrite temp→real ids across every still-pending envelope (a batch
 * that only partly flushed, or a later create that referenced an earlier one). Dead letters are
 * left alone.
 */
export async function rewriteOutboxIds(map: Map<number, number>): Promise<void> {
  if (map.size === 0) return;
  const db = await getDB();
  const tx = db.transaction("outbox", "readwrite");
  for (const rec of await tx.store.getAll()) {
    if (rec.status !== "pending") continue;
    rec.payload = rewriteValue(rec.payload, map);
    if (rec.tempId != null && map.has(rec.tempId)) rec.tempId = map.get(rec.tempId);
    rec.affects = rec.affects.map((a) => ({ ...a, id: map.get(a.id) ?? a.id }));
    await tx.store.put(rec);
  }
  await tx.done;
}
