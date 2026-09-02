import type { MutationEnvelope, MutationResult, SyncMutationsResponse } from "@logger/shared";
import { api, ApiError } from "../api/client.js";
import { getDB, setMeta, META_LAST_SYNC_ERROR, SYNC_STORES } from "../local/db.js";
import { markDeadLetter, pendingOutbox, removeOutbox } from "../local/outbox.js";
import { reconcileIds } from "./reconcile.js";

export interface PushResult {
  /** Envelopes the server accepted (applied / conflict / skipped) and we removed from the queue. */
  pushed: number;
  /** Envelopes the server rejected — moved to the dead-letter state. */
  dead: number;
  /** No attempt was made (offline, or nothing queued). */
  skipped?: boolean;
  /** The push failed as a whole; the queue is untouched. */
  error?: "auth" | "network";
}

let inFlight: Promise<PushResult> | null = null;

/**
 * Flush the outbox: `POST /api/sync/mutations` with every pending envelope in `seq` order,
 * fold the server's temp→real id map back into the replica, drain accepted envelopes and
 * dead-letter rejected ones. Single-flight. Never throws — a whole-batch failure comes back
 * as `{ error }` with the queue left intact for the next attempt.
 */
export function pushOutbox(): Promise<PushResult> {
  if (!inFlight) {
    inFlight = runPush().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** True while a push is running. */
export function isPushing(): boolean {
  return inFlight != null;
}

async function runPush(): Promise<PushResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { pushed: 0, dead: 0, skipped: true };
  }

  const queued = await pendingOutbox();
  if (queued.length === 0) {
    // Nothing to push, but a row can still be stranded `_localDirty` with no envelope — e.g. an
    // offline add-then-remove that annihilated its own pair. Reconcile it back to server truth.
    await finalizeLocalRows();
    return { pushed: 0, dead: 0, skipped: true };
  }

  const mutations: MutationEnvelope[] = queued.map((r) => ({
    mutationId: r.mutationId,
    type: r.type,
    tempId: r.tempId,
    payload: r.payload,
    baseVersion: r.baseVersion,
  }));
  await bumpAttempts(queued.map((r) => r.mutationId));

  let results: MutationResult[];
  try {
    const resp = await api.post<SyncMutationsResponse>("/sync/mutations", { mutations });
    results = resp.results;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await setMeta(META_LAST_SYNC_ERROR, "auth");
      return { pushed: 0, dead: 0, error: "auth" };
    }
    return { pushed: 0, dead: 0, error: "network" };
  }

  const idMap = new Map<number, number>();
  for (const r of results) {
    for (const [temp, real] of Object.entries(r.idMap ?? {})) idMap.set(Number(temp), real);
  }
  await reconcileIds(idMap);

  let pushed = 0;
  let dead = 0;
  for (const r of results) {
    if (r.status === "error") {
      await markDeadLetter(r.mutationId, r.error ?? "the server rejected this change");
      dead += 1;
    } else {
      await removeOutbox(r.mutationId);
      pushed += 1;
    }
  }

  await finalizeLocalRows();
  return { pushed, dead };
}

async function bumpAttempts(ids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("outbox", "readwrite");
  for (const id of ids) {
    const rec = await tx.store.get(id);
    if (rec) {
      rec.attempts += 1;
      await tx.store.put(rec);
    }
  }
  await tx.done;
}

/**
 * After a push: any locally-diverged row that no *still-pending* envelope references has
 * reached server truth — clear its `_localDirty`, or hard-delete it if it was `_localDeleted`.
 * A row a dead-lettered envelope "owned" also re-converges here (reads fall back to the server
 * copy on the next pull).
 */
async function finalizeLocalRows(): Promise<void> {
  const db = await getDB();
  const referenced = new Set<string>();
  for (const rec of await pendingOutbox()) {
    for (const a of rec.affects) referenced.add(`${a.store}:${a.id}`);
  }

  const tx = db.transaction([...SYNC_STORES], "readwrite");
  for (const store of SYNC_STORES) {
    const os = tx.objectStore(store);
    for (const row of await os.getAll()) {
      if (!row._localDirty && !row._localDeleted) continue;
      if (referenced.has(`${store}:${row.id}`)) continue;
      if (row._localDeleted) {
        await os.delete(row.id);
        continue;
      }
      delete row._localDirty;
      await os.put(row);
    }
  }
  await tx.done;
}
