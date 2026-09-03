import type { Category } from "./categories.js";
import type { NoteCategory } from "./notes.js";

/**
 * The delta-sync change-feed contract (`GET /api/sync/changes`).
 *
 * The server assigns every write a globally-monotonic `rowSeq` (DB triggers — see migration
 * 0007). A client stores the highest `rowSeq` it has applied and passes it back as the
 * cursor; the server returns every row that changed since, plus tombstones for deletions, in
 * `rowSeq` order. `since=0` (or a missing cursor) bootstraps the whole dataset.
 *
 * This is pull-only. The writes tier adds a `POST /api/sync/mutations` sibling; the DTOs here
 * already carry `version` so that contract stays stable.
 */

/** The tables the change-feed replicates. */
export type SyncEntityType = "entity" | "log" | "log_photo" | "album" | "entity_note";

/** Opaque pagination token for `GET /api/sync/changes`. Currently a `rowSeq` high-watermark. */
export type SyncCursor = string;

/** Sync bookkeeping present on every change-feed row. */
export interface SyncMeta {
  rowSeq: number;
  /** Bumps on every server-applied update. Unused by pull-only clients; kept for the writes tier. */
  version: number;
}

export interface EntitySyncDTO extends SyncMeta {
  id: number;
  category: Category;
  title: string;
  normalizedTitle: string;
  releaseYear: number | null;
  author: string | null;
  createdAt: string;
}

export interface LogSyncDTO extends SyncMeta {
  id: number;
  entityId: number;
  rating: number | null;
  date: string;
  notes: string | null;
  autoDelete: boolean;
  createdAt: string;
  updatedAt: string;
  /** Tagged person-entity ids. */
  peopleIds: number[];
  /** Attached photo ids, oldest first. */
  photoIds: number[];
  /** Albums this log is a linked event of. */
  albumIds: number[];
}

export interface PhotoSyncDTO extends SyncMeta {
  id: number;
  logId: number | null;
  albumId: number | null;
  /** Path to the full-size image under /api/photos. */
  url: string;
  /** Path to the server-generated thumbnail under /api/photos. */
  thumbnailUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface AlbumSyncDTO extends SyncMeta {
  id: number;
  title: string;
  notes: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  createdAt: string;
  updatedAt: string;
  /** Logs linked to this album as events. */
  eventLogIds: number[];
  /** People added to the album directly (not the tagged-on-events union — the client computes that). */
  personIds: number[];
}

export interface EntityNoteSyncDTO extends SyncMeta {
  id: number;
  entityId: number;
  category: NoteCategory;
  body: string;
  tag: string | null;
  eventDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A deleted row. The client drops its local copy (and any children it can no longer reach). */
export interface SyncTombstone {
  entityType: SyncEntityType;
  id: number;
  rowSeq: number;
  deletedAt: string;
}

// ---------------------------------------------------------------------------
// Write path — `POST /api/sync/mutations` (the writes tier)
// ---------------------------------------------------------------------------

/**
 * The mutations the offline outbox can queue and replay. Photo add/delete are deliberately
 * absent — photos stay online-only. `entity.update` / `entity.delete` have no UI.
 */
export type MutationType =
  | "entity.create"
  | "log.create"
  | "log.update"
  | "log.delete"
  | "album.create"
  | "album.update"
  | "album.delete"
  | "album.addEvent"
  | "album.removeEvent"
  | "album.addPerson"
  | "album.removePerson"
  | "note.create"
  | "note.update"
  | "note.delete";

/**
 * One queued write. `payload` mirrors the matching REST body but its id references may be
 * **negative temp ids** — placeholders the client minted for rows the server hasn't seen yet.
 * The server resolves them from earlier `*.create` results in the same batch. `tempId` (also
 * negative) is the placeholder for the row a `*.create` produces. `baseVersion` is the
 * `version` the client last saw, for last-write-wins conflict reporting on `*.update`.
 */
export interface MutationEnvelope {
  mutationId: string;
  type: MutationType;
  tempId?: number;
  payload: unknown;
  baseVersion?: number;
}

export interface MutationResult {
  mutationId: string;
  status: "applied" | "conflict" | "skipped" | "error";
  /** temp id → real server id, for every row this mutation created (incl. dedup collapses). */
  idMap?: Record<number, number>;
  /** The row's `version` after the write (for `*.update`). */
  serverVersion?: number;
  error?: string;
}

export interface SyncMutationsRequest {
  mutations: MutationEnvelope[];
}

export interface SyncMutationsResponse {
  results: MutationResult[];
}

/** Response for `GET /api/sync/changes`. */
export interface SyncChangesResponse {
  /** Upserts since the cursor, grouped by table; each group is ordered by `rowSeq` ascending. */
  changes: {
    entities: EntitySyncDTO[];
    logs: LogSyncDTO[];
    photos: PhotoSyncDTO[];
    albums: AlbumSyncDTO[];
    entityNotes: EntityNoteSyncDTO[];
  };
  /** Deletions since the cursor, ordered by `rowSeq` ascending. */
  deletions: SyncTombstone[];
  /** Pass as `?since=` for the next page. Advances even when nothing changed. */
  nextCursor: SyncCursor;
  /** True when another request with `nextCursor` will return more rows. */
  hasMore: boolean;
  /** Server wall-clock at response time (ISO). Advisory only — never sync-order on it. */
  serverTime: string;
}
