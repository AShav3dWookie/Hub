import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  LogSyncDTO,
  PhotoSyncDTO,
} from "@logger/shared";
import { getDB } from "./db.js";
import { expiredAppointmentLogIds } from "./sweep.js";

/**
 * An in-memory view of the whole local replica. Every `repo` read loads one of these and runs
 * a pure function over it — the server's query services are mostly in-memory filter/sort
 * already, and the dataset is a personal-scale few thousand rows at most.
 *
 * Expired auto-delete appointment logs are filtered out here (the client-side sweep), so no
 * downstream query has to think about them.
 */
export interface LocalSnapshot {
  entities: EntitySyncDTO[];
  logs: LogSyncDTO[];
  photos: PhotoSyncDTO[];
  albums: AlbumSyncDTO[];
  notes: EntityNoteSyncDTO[];
  entityById: Map<number, EntitySyncDTO>;
  logById: Map<number, LogSyncDTO>;
  photoById: Map<number, PhotoSyncDTO>;
  albumById: Map<number, AlbumSyncDTO>;
}

function index<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export function buildSnapshot(
  data: {
    entities: EntitySyncDTO[];
    logs: LogSyncDTO[];
    photos: PhotoSyncDTO[];
    albums: AlbumSyncDTO[];
    notes: EntityNoteSyncDTO[];
  },
  now: Date = new Date(),
): LocalSnapshot {
  const entityById = index(data.entities);
  const expired = expiredAppointmentLogIds(data.logs, entityById, now);
  const logs = expired.size > 0 ? data.logs.filter((l) => !expired.has(l.id)) : data.logs;

  return {
    entities: data.entities,
    logs,
    photos: data.photos,
    albums: data.albums,
    notes: data.notes,
    entityById,
    logById: index(logs),
    photoById: index(data.photos),
    albumById: index(data.albums),
  };
}

export async function loadSnapshot(now: Date = new Date()): Promise<LocalSnapshot> {
  const db = await getDB();
  const [entities, logs, photos, albums, notes] = await Promise.all([
    db.getAll("entities"),
    db.getAll("logs"),
    db.getAll("photos"),
    db.getAll("albums"),
    db.getAll("entityNotes"),
  ]);
  return buildSnapshot({ entities, logs, photos, albums, notes }, now);
}
