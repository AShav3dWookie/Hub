import { asc, gt, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import {
  albums,
  albumEvents,
  albumPeople,
  entities,
  entityNotes,
  logs,
  logPeople,
  logPhotos,
  syncDeletions,
} from "../db/schema.js";
import { sweepExpiredAppointments } from "./upcomingEventsService.js";
import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  LogSyncDTO,
  PhotoSyncDTO,
  SyncChangesResponse,
  SyncTombstone,
} from "@logger/shared";

export const DEFAULT_SYNC_LIMIT = 500;

export interface SyncChangesQuery {
  since?: number;
  limit?: number;
}

type EntityRow = typeof entities.$inferSelect;
type LogRow = typeof logs.$inferSelect;
type PhotoRow = typeof logPhotos.$inferSelect;
type AlbumRow = typeof albums.$inferSelect;
type NoteRow = typeof entityNotes.$inferSelect;
type DeletionRow = typeof syncDeletions.$inferSelect;

/** Group `rows` into a `Map<parentId, childId[]>` from `{ parent, child }` pairs, insertion order preserved. */
function groupIds(rows: Array<{ parent: number; child: number }>): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const { parent, child } of rows) {
    const list = map.get(parent);
    if (list) list.push(child);
    else map.set(parent, [child]);
  }
  return map;
}

function toEntitySyncDTO(r: EntityRow): EntitySyncDTO {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    normalizedTitle: r.normalizedTitle,
    releaseYear: r.releaseYear,
    author: r.author,
    createdAt: r.createdAt,
    rowSeq: r.rowSeq,
    version: r.version,
  };
}

function toPhotoSyncDTO(r: PhotoRow): PhotoSyncDTO {
  return {
    id: r.id,
    logId: r.logId,
    albumId: r.albumId,
    url: `/api/photos/${r.filename}`,
    thumbnailUrl: `/api/photos/${r.thumbnailFilename}`,
    originalName: r.originalName,
    mimeType: r.mimeType,
    size: r.size,
    createdAt: r.createdAt,
    rowSeq: r.rowSeq,
    version: r.version,
  };
}

function toEntityNoteSyncDTO(r: NoteRow): EntityNoteSyncDTO {
  return {
    id: r.id,
    entityId: r.entityId,
    category: r.category as EntityNoteSyncDTO["category"],
    body: r.body,
    tag: r.tag,
    eventDate: r.eventDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    rowSeq: r.rowSeq,
    version: r.version,
  };
}

function toTombstone(r: DeletionRow): SyncTombstone {
  return { entityType: r.entityType, id: r.entityId, rowSeq: r.rowSeq, deletedAt: r.deletedAt };
}

/**
 * The delta-sync change-feed. Returns every syncable row and tombstone with `rowSeq > since`,
 * merged into one `rowSeq`-ordered window of at most `limit` items, then re-partitioned by
 * table. `hasMore` + `nextCursor` page the caller forward; when nothing is left `nextCursor`
 * still advances to the current high-watermark so the next poll is cheap.
 *
 * Runs the expired-appointment sweep first so those deletions surface as tombstones.
 */
export function getChanges(db: AppDb, query: SyncChangesQuery = {}): SyncChangesResponse {
  const since = query.since ?? 0;
  const limit = query.limit ?? DEFAULT_SYNC_LIMIT;

  sweepExpiredAppointments(db);

  // One extra row per source tells us whether a further page exists without a second query.
  const cap = limit + 1;
  const entityRows = db
    .select()
    .from(entities)
    .where(gt(entities.rowSeq, since))
    .orderBy(asc(entities.rowSeq))
    .limit(cap)
    .all();
  const logRows = db
    .select()
    .from(logs)
    .where(gt(logs.rowSeq, since))
    .orderBy(asc(logs.rowSeq))
    .limit(cap)
    .all();
  const photoRows = db
    .select()
    .from(logPhotos)
    .where(gt(logPhotos.rowSeq, since))
    .orderBy(asc(logPhotos.rowSeq))
    .limit(cap)
    .all();
  const albumRows = db
    .select()
    .from(albums)
    .where(gt(albums.rowSeq, since))
    .orderBy(asc(albums.rowSeq))
    .limit(cap)
    .all();
  const noteRows = db
    .select()
    .from(entityNotes)
    .where(gt(entityNotes.rowSeq, since))
    .orderBy(asc(entityNotes.rowSeq))
    .limit(cap)
    .all();
  const deletionRows = db
    .select()
    .from(syncDeletions)
    .where(gt(syncDeletions.rowSeq, since))
    .orderBy(asc(syncDeletions.rowSeq))
    .limit(cap)
    .all();

  type Item =
    | { seq: number; kind: "entity"; row: EntityRow }
    | { seq: number; kind: "log"; row: LogRow }
    | { seq: number; kind: "photo"; row: PhotoRow }
    | { seq: number; kind: "album"; row: AlbumRow }
    | { seq: number; kind: "note"; row: NoteRow }
    | { seq: number; kind: "deletion"; row: DeletionRow };

  const merged: Item[] = [
    ...entityRows.map((row): Item => ({ seq: row.rowSeq, kind: "entity", row })),
    ...logRows.map((row): Item => ({ seq: row.rowSeq, kind: "log", row })),
    ...photoRows.map((row): Item => ({ seq: row.rowSeq, kind: "photo", row })),
    ...albumRows.map((row): Item => ({ seq: row.rowSeq, kind: "album", row })),
    ...noteRows.map((row): Item => ({ seq: row.rowSeq, kind: "note", row })),
    ...deletionRows.map((row): Item => ({ seq: row.rowSeq, kind: "deletion", row })),
  ].sort((a, b) => a.seq - b.seq);

  const hasMore = merged.length > limit;
  const windowItems = hasMore ? merged.slice(0, limit) : merged;

  const highWater = windowItems.length > 0 ? windowItems[windowItems.length - 1].seq : since;
  const nextCursor = String(Math.max(since, highWater));

  const incEntities: EntityRow[] = [];
  const incLogs: LogRow[] = [];
  const incPhotos: PhotoRow[] = [];
  const incAlbums: AlbumRow[] = [];
  const incNotes: NoteRow[] = [];
  const incDeletions: DeletionRow[] = [];
  for (const item of windowItems) {
    switch (item.kind) {
      case "entity":
        incEntities.push(item.row);
        break;
      case "log":
        incLogs.push(item.row);
        break;
      case "photo":
        incPhotos.push(item.row);
        break;
      case "album":
        incAlbums.push(item.row);
        break;
      case "note":
        incNotes.push(item.row);
        break;
      case "deletion":
        incDeletions.push(item.row);
        break;
    }
  }

  return {
    changes: {
      entities: incEntities.map(toEntitySyncDTO),
      logs: buildLogSyncDTOs(db, incLogs),
      photos: incPhotos.map(toPhotoSyncDTO),
      albums: buildAlbumSyncDTOs(db, incAlbums),
      entityNotes: incNotes.map(toEntityNoteSyncDTO),
    },
    deletions: incDeletions.map(toTombstone),
    nextCursor,
    hasMore,
    serverTime: new Date().toISOString(),
  };
}

function buildLogSyncDTOs(db: AppDb, rows: LogRow[]): LogSyncDTO[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const peopleByLog = groupIds(
    db
      .select({ parent: logPeople.logId, child: logPeople.personEntityId })
      .from(logPeople)
      .where(inArray(logPeople.logId, ids))
      .all(),
  );
  const photosByLog = groupIds(
    db
      .select({ parent: logPhotos.logId, child: logPhotos.id })
      .from(logPhotos)
      .where(inArray(logPhotos.logId, ids))
      .orderBy(asc(logPhotos.id))
      .all()
      .filter((r): r is { parent: number; child: number } => r.parent != null),
  );
  const albumsByLog = groupIds(
    db
      .select({ parent: albumEvents.logId, child: albumEvents.albumId })
      .from(albumEvents)
      .where(inArray(albumEvents.logId, ids))
      .all(),
  );

  return rows.map((r) => ({
    id: r.id,
    entityId: r.entityId,
    rating: r.rating,
    date: r.date,
    notes: r.notes,
    autoDelete: r.autoDelete,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    peopleIds: peopleByLog.get(r.id) ?? [],
    photoIds: photosByLog.get(r.id) ?? [],
    albumIds: albumsByLog.get(r.id) ?? [],
    rowSeq: r.rowSeq,
    version: r.version,
  }));
}

function buildAlbumSyncDTOs(db: AppDb, rows: AlbumRow[]): AlbumSyncDTO[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const eventsByAlbum = groupIds(
    db
      .select({ parent: albumEvents.albumId, child: albumEvents.logId })
      .from(albumEvents)
      .where(inArray(albumEvents.albumId, ids))
      .all(),
  );
  const peopleByAlbum = groupIds(
    db
      .select({ parent: albumPeople.albumId, child: albumPeople.personEntityId })
      .from(albumPeople)
      .where(inArray(albumPeople.albumId, ids))
      .all(),
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    dateStart: r.dateStart,
    dateEnd: r.dateEnd,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    eventLogIds: eventsByAlbum.get(r.id) ?? [],
    personIds: peopleByAlbum.get(r.id) ?? [],
    rowSeq: r.rowSeq,
    version: r.version,
  }));
}

export { toEntitySyncDTO, toPhotoSyncDTO, toEntityNoteSyncDTO };
