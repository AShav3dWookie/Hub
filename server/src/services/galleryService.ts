import { and, eq, lt, or, desc, isNotNull, inArray, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { logs, logPhotos, logPeople, entities, albumEvents, albumPeople } from "../db/schema.js";
import { toLogPhotoDTO } from "./logPhotosService.js";
import type { GalleryPhotoDTO, GalleryResponse, LoggableCategory } from "@logger/shared";

export const DEFAULT_GALLERY_LIMIT = 50;

export interface GalleryQuery {
  cursor?: number;
  limit?: number;
  /**
   * When set, restrict to photos credited to this person: photos whose parent log tags them
   * (via log_people) OR loose photos of an album they were added to directly (via album_people).
   */
  personId?: number;
  /**
   * When set, restrict to an album's photos: loose photos (album_id) plus every photo of a linked
   * event's log. Pass at most one of personId / albumId.
   */
  albumId?: number;
}

/**
 * Uploaded photos, newest first. Ordered by log_photos.id DESC (monotonic with upload
 * time) so the cursor is a plain integer. Photos whose log was deleted come back with
 * `log: null`. `personId` restricts to photos credited to that person (tagged log OR a
 * directly-joined album's loose photos); `albumId` restricts to an album's photos (loose
 * + every linked event's). Both scopes key off log_photos.id — every photo appears at
 * most once (the OR-branches are disjoint via the album_id-null partition).
 */
export function listGalleryPhotos(db: AppDb, query: GalleryQuery = {}): GalleryResponse {
  const limit = query.limit ?? DEFAULT_GALLERY_LIMIT;

  // Fetch one extra row to know whether a next page exists (avoids a trailing empty page).
  const base = db
    .select({
      photo: logPhotos,
      logId: logs.id,
      entityId: logs.entityId,
      logDate: logs.date,
      entityTitle: entities.title,
      entityCategory: entities.category,
    })
    .from(logPhotos)
    .leftJoin(logs, eq(logs.id, logPhotos.logId))
    .leftJoin(entities, eq(entities.id, logs.entityId))
    .$dynamic();

  const cursorCond = query.cursor != null ? lt(logPhotos.id, query.cursor) : undefined;

  let scoped = base;
  let scopeCond: SQL | undefined;

  if (query.personId != null) {
    // Left join (not inner) so we can OR the person-log match with the album-people match.
    // log_people is unique on (logId, personEntityId) → 0-or-1 rows → no fan-out.
    scoped = base.leftJoin(
      logPeople,
      and(eq(logPeople.logId, logPhotos.logId), eq(logPeople.personEntityId, query.personId)),
    );
    const directAlbumIds = db
      .select({ id: albumPeople.albumId })
      .from(albumPeople)
      .where(eq(albumPeople.personEntityId, query.personId));
    scopeCond = or(
      isNotNull(logPeople.personEntityId),
      inArray(logPhotos.albumId, directAlbumIds),
    );
  } else if (query.albumId != null) {
    const linkedLogIds = db
      .select({ id: albumEvents.logId })
      .from(albumEvents)
      .where(eq(albumEvents.albumId, query.albumId));
    scopeCond = or(
      eq(logPhotos.albumId, query.albumId),
      inArray(logPhotos.logId, linkedLogIds),
    );
  }

  const rows = scoped
    .where(and(cursorCond, scopeCond))
    .orderBy(desc(logPhotos.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const photos: GalleryPhotoDTO[] = pageRows.map((row) => ({
    ...toLogPhotoDTO(row.photo),
    log:
      row.logId != null
        ? {
            id: row.logId,
            entityId: row.entityId as number,
            entityTitle: row.entityTitle as string,
            category: row.entityCategory as LoggableCategory,
            date: row.logDate as string,
          }
        : null,
  }));

  const nextCursor = hasMore ? photos[photos.length - 1].id : null;

  return { photos, nextCursor };
}
