import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  LogSyncDTO,
  PhotoSyncDTO,
} from "@logger/shared";
import { getDB, type LocalWriteMeta } from "./db.js";
import { expiredAppointmentLogIds } from "./sweep.js";

/**
 * An in-memory view of the whole local replica. Every `repo` read loads one of these and runs
 * a pure function over it — the server's query services are mostly in-memory filter/sort
 * already, and the dataset is a personal-scale few thousand rows at most.
 *
 * Expired auto-delete appointment logs are filtered out here (the client-side sweep), so no
 * downstream query has to think about them. Rows the writes tier has soft-deleted
 * (`_localDeleted`) are dropped here too — the replica keeps them until their `*.delete`
 * envelope flushes, but no read should ever see them.
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

const live = <T extends LocalWriteMeta>(rows: T[]): T[] => rows.filter((r) => !r._localDeleted);

export function buildSnapshot(
  data: {
    entities: (EntitySyncDTO & LocalWriteMeta)[];
    logs: (LogSyncDTO & LocalWriteMeta)[];
    photos: (PhotoSyncDTO & LocalWriteMeta)[];
    albums: (AlbumSyncDTO & LocalWriteMeta)[];
    notes: (EntityNoteSyncDTO & LocalWriteMeta)[];
  },
  now: Date = new Date(),
): LocalSnapshot {
  const entities = live(data.entities);
  const photos = live(data.photos);
  const albums = live(data.albums);
  const notes = live(data.notes);

  const entityById = index(entities);
  const notDeleted = live(data.logs);
  const expired = expiredAppointmentLogIds(notDeleted, entityById, now);
  const logs = expired.size > 0 ? notDeleted.filter((l) => !expired.has(l.id)) : notDeleted;

  return {
    entities,
    logs,
    photos,
    albums,
    notes,
    entityById,
    logById: index(logs),
    photoById: index(photos),
    albumById: index(albums),
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
