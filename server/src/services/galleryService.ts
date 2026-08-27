import { and, eq, lt, desc } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { logs, logPhotos, logPeople, entities } from "../db/schema.js";
import { toLogPhotoDTO } from "./logPhotosService.js";
import type { GalleryPhotoDTO, GalleryResponse, LoggableCategory } from "@logger/shared";

export const DEFAULT_GALLERY_LIMIT = 50;

export interface GalleryQuery {
  cursor?: number;
  limit?: number;
  /** When set, restrict to photos whose parent log tags this person (via log_people). */
  personId?: number;
}

/**
 * Uploaded photos, newest first. Ordered by log_photos.id DESC (monotonic with upload
 * time) so the cursor is a plain integer. Photos whose log was deleted come back with
 * `log: null`. With `personId`, restricted to photos from logs that tag that person
 * (an inner join, so orphaned photos are excluded).
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

  const filtered =
    query.personId != null
      ? base.innerJoin(
          logPeople,
          and(
            eq(logPeople.logId, logPhotos.logId),
            eq(logPeople.personEntityId, query.personId),
          ),
        )
      : base;

  const rows = filtered
    .where(query.cursor != null ? lt(logPhotos.id, query.cursor) : undefined)
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
