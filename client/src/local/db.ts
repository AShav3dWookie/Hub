import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  LogSyncDTO,
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
export const DB_VERSION = 1;

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface LoggerDBSchema extends DBSchema {
  entities: {
    key: number;
    value: EntitySyncDTO;
    indexes: { "by-category": string; "by-rowSeq": number };
  };
  logs: {
    key: number;
    value: LogSyncDTO;
    indexes: { "by-entity": number; "by-date": string; "by-rowSeq": number };
  };
  photos: {
    key: number;
    value: PhotoSyncDTO;
    indexes: { "by-log": number; "by-album": number; "by-rowSeq": number };
  };
  albums: {
    key: number;
    value: AlbumSyncDTO;
    indexes: { "by-rowSeq": number };
  };
  entityNotes: {
    key: number;
    value: EntityNoteSyncDTO;
    indexes: { "by-entity": number; "by-rowSeq": number };
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

let dbPromise: Promise<LoggerDB> | null = null;

/** Open (creating/upgrading as needed) the shared connection. */
export function getDB(): Promise<LoggerDB> {
  if (!dbPromise) {
    dbPromise = openDB<LoggerDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
