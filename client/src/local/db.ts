import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  LogSyncDTO,
  MutationType,
  PhotoSyncDTO,
} from "@logger/shared";

/**
 * The device-local replica of the server's data, maintained by the sync engine from the
 * `GET /api/sync/changes` feed. Rows are stored in their sync-DTO shape (they carry `rowSeq`
 * + the denormalised link arrays); view DTOs (`LogDTO`, `EntityWithLogsDTO`, …) are derived
 * on read by `repo.ts`.
 *
 * Nothing here writes on user actions — in the read-only lite tier the replica is a pure
 * projection of server state.
 */

export const DB_NAME = "logger";
export const DB_VERSION = 2;

export interface MetaRecord {
  key: string;
  value: unknown;
}

/**
 * Fields the writes tier stamps on a local row that has diverged from server state. Both are
 * absent on a clean, server-sourced row.
 */
export interface LocalWriteMeta {
  /** The row carries un-pushed local changes. Cleared once the outbox drains (see reconcile). */
  _localDirty?: boolean;
  /** Soft delete — filtered out of snapshots; hard-deleted once its `*.delete` envelope flushes. */
  _localDeleted?: boolean;
}

export type LocalEntity = EntitySyncDTO & LocalWriteMeta;
export type LocalLog = LogSyncDTO & LocalWriteMeta;
export type LocalPhoto = PhotoSyncDTO & LocalWriteMeta;
export type LocalAlbum = AlbumSyncDTO & LocalWriteMeta;
export type LocalEntityNote = EntityNoteSyncDTO & LocalWriteMeta;

export type OutboxStatus = "pending" | "dead";

/** One queued offline write, awaiting replay via `POST /api/sync/mutations`. */
export interface OutboxRecord {
  mutationId: string;
  type: MutationType;
  /** Negative placeholder id for the row a `*.create` produces. */
  tempId?: number;
  payload: unknown;
  /** `version` the client last saw, for last-write-wins conflict reporting on `*.update`. */
  baseVersion?: number;
  /** Monotonic queue order — the server replays in this order. */
  seq: number;
  createdAt: string;
  attempts: number;
  status: OutboxStatus;
  /** Set when `status === "dead"`. */
  error?: string;
  /** Local rows this envelope owns — used to clear `_localDirty` / hard-delete after a push. */
  affects: { store: SyncStore; id: number }[];
}

export interface LoggerDBSchema extends DBSchema {
  entities: {
    key: number;
    value: LocalEntity;
    indexes: { "by-category": string; "by-rowSeq": number };
  };
  logs: {
    key: number;
    value: LocalLog;
    indexes: { "by-entity": number; "by-date": string; "by-rowSeq": number };
  };
  photos: {
    key: number;
    value: LocalPhoto;
    indexes: { "by-log": number; "by-album": number; "by-rowSeq": number };
  };
  albums: {
    key: number;
    value: LocalAlbum;
    indexes: { "by-rowSeq": number };
  };
  entityNotes: {
    key: number;
    value: LocalEntityNote;
    indexes: { "by-entity": number; "by-rowSeq": number };
  };
  outbox: {
    key: string;
    value: OutboxRecord;
    indexes: { "by-seq": number };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

export type LoggerDB = IDBPDatabase<LoggerDBSchema>;

/** The syncable object stores, in the order the change-feed lists them. */
export const SYNC_STORES = ["entities", "logs", "photos", "albums", "entityNotes"] as const;
export type SyncStore = (typeof SYNC_STORES)[number];

/** Every store a local write may touch, for the one big `applyLocalMutation` transaction. */
export const WRITE_TX_STORES = [
  ...SYNC_STORES,
  "outbox",
  "meta",
] as const;

let dbPromise: Promise<LoggerDB> | null = null;

/** Open (creating/upgrading as needed) the shared connection. */
export function getDB(): Promise<LoggerDB> {
  if (!dbPromise) {
    dbPromise = openDB<LoggerDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const entities = db.createObjectStore("entities", { keyPath: "id" });
          entities.createIndex("by-category", "category");
          entities.createIndex("by-rowSeq", "rowSeq");

          const logs = db.createObjectStore("logs", { keyPath: "id" });
          logs.createIndex("by-entity", "entityId");
          logs.createIndex("by-date", "date");
          logs.createIndex("by-rowSeq", "rowSeq");

          const photos = db.createObjectStore("photos", { keyPath: "id" });
          photos.createIndex("by-log", "logId");
          photos.createIndex("by-album", "albumId");
          photos.createIndex("by-rowSeq", "rowSeq");

          const albums = db.createObjectStore("albums", { keyPath: "id" });
          albums.createIndex("by-rowSeq", "rowSeq");

          const notes = db.createObjectStore("entityNotes", { keyPath: "id" });
          notes.createIndex("by-entity", "entityId");
          notes.createIndex("by-rowSeq", "rowSeq");

          db.createObjectStore("meta", { keyPath: "key" });
        }

        if (oldVersion < 2) {
          // Writes tier: the offline mutation queue. `_localDirty` / `_localDeleted` are
          // untyped optional fields on the sync stores — no schema change, no index.
          const outbox = db.createObjectStore("outbox", { keyPath: "mutationId" });
          outbox.createIndex("by-seq", "seq");
        }
      },
    });
  }
  return dbPromise;
}

/** Close the shared connection and drop the handle. Tests call this before deleting the DB. */
export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

// ---- meta helpers -------------------------------------------------------------

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await (await getDB()).get("meta", key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDB()).put("meta", { key, value });
}

export const META_SYNC_CURSOR = "syncCursor";
export const META_LAST_SYNC_AT = "lastSyncAt";
export const META_LAST_SYNC_ERROR = "lastSyncError";
/** Last-known `GET /auth/status` payload, so ProtectedRoute can resolve while offline. */
export const META_AUTH_STATUS = "authStatus";
/** Descending counter for offline temp ids: -1, -2, -3, … */
export const META_TEMP_ID_SEQ = "tempIdSeq";
/** Ascending counter for outbox queue order: 1, 2, 3, … */
export const META_OUTBOX_SEQ = "outboxSeq";
