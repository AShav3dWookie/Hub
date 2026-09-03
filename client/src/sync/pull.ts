import type { SyncChangesResponse } from "@logger/shared";
import { api, ApiError } from "../api/client.js";
import {
  getMeta,
  setMeta,
  META_SYNC_CURSOR,
  META_LAST_SYNC_AT,
  META_LAST_SYNC_ERROR,
} from "../local/db.js";
import { applyChanges, countChanges } from "./apply.js";
import { warmThumbnails } from "./thumbnailCache.js";

export interface PullResult {
  pages: number;
  rows: number;
  cursor: string;
}

/** Why the last sync failed, surfaced in Settings. `"auth"` means the session expired. */
export type SyncErrorKind = "auth" | "network" | "unknown";

export class SyncError extends Error {
  constructor(
    public kind: SyncErrorKind,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

function classify(err: unknown): SyncErrorKind {
  if (err instanceof ApiError) return err.status === 401 ? "auth" : "network";
  if (err instanceof TypeError) return "network"; // fetch() rejects with TypeError when offline
  return "unknown";
}

let inFlight: Promise<PullResult> | null = null;

/**
 * Pull every change since the stored cursor and apply it, page by page. Single-flight: a
 * concurrent call returns the in-progress run rather than starting a second.
 *
 * A `401` is non-destructive — the replica and cursor are left intact and the error is
 * recorded as `"auth"` so the UI can prompt re-login.
 */
export function pullChanges(): Promise<PullResult> {
  if (!inFlight) {
    inFlight = runPull().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** True while a pull is running (for the single-flight guard in the engine / UI). */
export function isPulling(): boolean {
  return inFlight != null;
}

async function runPull(): Promise<PullResult> {
  let cursor = (await getMeta<string>(META_SYNC_CURSOR)) ?? "0";
  let pages = 0;
  let rows = 0;
  const thumbUrls: string[] = [];

  try {
    for (;;) {
      const resp = await api.get<SyncChangesResponse>(
        `/sync/changes?since=${encodeURIComponent(cursor)}`,
      );
      await applyChanges(resp);
      pages += 1;
      rows += countChanges(resp);
      for (const photo of resp.changes.photos) thumbUrls.push(photo.thumbnailUrl);
      cursor = resp.nextCursor;
      if (!resp.hasMore) break;
    }
  } catch (err) {
    const kind = classify(err);
    await setMeta(META_LAST_SYNC_ERROR, kind);
    throw new SyncError(kind, `sync pull failed (${kind})`, err);
  }

  await setMeta(META_LAST_SYNC_AT, Date.now());
  await setMeta(META_LAST_SYNC_ERROR, null);

  // Best-effort, non-blocking: keep the thumbnail cache complete for offline browsing.
  void warmThumbnails(thumbUrls);

  return { pages, rows, cursor };
}
