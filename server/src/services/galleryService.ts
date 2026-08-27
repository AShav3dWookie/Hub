import { eq, lt, desc } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { logs, logPhotos, entities } from "../db/schema.js";
import { toLogPhotoDTO } from "./logPhotosService.js";
import type { GalleryPhotoDTO, GalleryResponse, LoggableCategory } from "@logger/shared";

export const DEFAULT_GALLERY_LIMIT = 50;

export interface GalleryQuery {
  cursor?: number;
  limit?: number;
}

/**
 * All uploaded photos, newest first. Ordered by log_photos.id DESC (monotonic with
 * upload time) so the cursor is a plain integer. Photos whose log was deleted come
 * back with `log: null`.
 */
export function listGalleryPhotos(db: AppDb, query: GalleryQuery = {}): GalleryResponse {
  const limit = query.limit ?? DEFAULT_GALLERY_LIMIT;

  const rows = db
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
    .where(query.cursor != null ? lt(logPhotos.id, query.cursor) : undefined)
    .orderBy(desc(logPhotos.id))
    .limit(limit)
    .all();

  const photos: GalleryPhotoDTO[] = rows.map((row) => ({
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

  const nextCursor = rows.length === limit ? rows[rows.length - 1].photo.id : null;

  return { photos, nextCursor };
}
