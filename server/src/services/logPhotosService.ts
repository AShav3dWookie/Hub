import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { eq, inArray, asc } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { logs, logPhotos } from "../db/schema.js";
import { getEntityById } from "./entityService.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import { categorySupportsPhotos } from "@logger/shared";
import type { LogPhotoDTO } from "@logger/shared";

export const MAX_PHOTOS_PER_LOG = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const THUMBNAIL_SIZE = 400;

/** Allowed upload MIME types → on-disk extension for the stored original. */
export const ALLOWED_PHOTO_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** The subset of a multer file we actually use — kept minimal so the service is easy to call from tests. */
export interface UploadedPhoto {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export function toLogPhotoDTO(row: typeof logPhotos.$inferSelect): LogPhotoDTO {
  return {
    id: row.id,
    logId: row.logId,
    url: `/api/photos/${row.filename}`,
    thumbnailUrl: `/api/photos/${row.thumbnailFilename}`,
    originalName: row.originalName,
    createdAt: row.createdAt,
  };
}

/** Batch lookup mirroring getPeopleForLogs in logService — photos grouped by logId, oldest first. */
export function getPhotosForLogs(db: AppDb, logIds: number[]): Map<number, LogPhotoDTO[]> {
  const result = new Map<number, LogPhotoDTO[]>();
  if (logIds.length === 0) return result;

  const rows = db
    .select()
    .from(logPhotos)
    .where(inArray(logPhotos.logId, logIds))
    .orderBy(asc(logPhotos.id))
    .all();

  for (const row of rows) {
    const list = result.get(row.logId) ?? [];
    list.push(toLogPhotoDTO(row));
    result.set(row.logId, list);
  }
  return result;
}

export function listLogPhotos(db: AppDb, logId: number): LogPhotoDTO[] {
  return getPhotosForLogs(db, [logId]).get(logId) ?? [];
}

/**
 * Guard: the log must exist and its parent entity's category must support photos
 * (see categorySupportsPhotos — currently Movie / Eating Out). This is the
 * server-side enforcement of the feature's scope, independent of the UI.
 */
export function assertLogSupportsPhotos(db: AppDb, logId: number): void {
  const log = db.select().from(logs).where(eq(logs.id, logId)).get();
  if (!log) {
    throw new NotFoundError(`Log ${logId} not found`);
  }
  const entity = getEntityById(db, log.entityId);
  if (!categorySupportsPhotos(entity.category)) {
    throw new BadRequestError(`Logs for category "${entity.category}" cannot have photos`);
  }
}

/**
 * Store uploaded files for a log: original on disk under a random filename, plus a
 * resized thumbnail, plus a DB row per photo. Enforces the per-log count, per-file
 * size, and MIME-type limits. Returns the created photos as DTOs.
 */
export async function createLogPhotos(
  db: AppDb,
  photosDir: string,
  logId: number,
  files: UploadedPhoto[],
): Promise<LogPhotoDTO[]> {
  assertLogSupportsPhotos(db, logId);

  if (files.length === 0) {
    throw new BadRequestError("No photos provided");
  }

  const existingCount = db
    .select({ id: logPhotos.id })
    .from(logPhotos)
    .where(eq(logPhotos.logId, logId))
    .all().length;

  if (existingCount + files.length > MAX_PHOTOS_PER_LOG) {
    throw new BadRequestError(
      `A log can have at most ${MAX_PHOTOS_PER_LOG} photos (currently ${existingCount})`,
    );
  }

  for (const file of files) {
    if (!ALLOWED_PHOTO_MIME_TYPES[file.mimetype]) {
      throw new BadRequestError(`Unsupported image type: ${file.mimetype}`);
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestError("Each photo must be 10MB or smaller");
    }
  }

  fs.mkdirSync(photosDir, { recursive: true });

  const created: LogPhotoDTO[] = [];
  for (const file of files) {
    const ext = ALLOWED_PHOTO_MIME_TYPES[file.mimetype];
    const base = randomUUID();
    const filename = `${base}.${ext}`;
    const originalPath = path.join(photosDir, filename);

    fs.writeFileSync(originalPath, file.buffer);

    // Thumbnail is best-effort: if sharp can't decode this format (e.g. HEIC
    // without libheif in the build), fall back to serving the original.
    let thumbnailFilename = filename;
    try {
      const generated = `${base}_thumb.webp`;
      await sharp(file.buffer)
        .rotate()
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(path.join(photosDir, generated));
      thumbnailFilename = generated;
    } catch {
      // keep thumbnailFilename === filename
    }

    const inserted = db
      .insert(logPhotos)
      .values({
        logId,
        filename,
        thumbnailFilename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      })
      .returning()
      .get();

    created.push(toLogPhotoDTO(inserted));
  }

  return created;
}

/** Delete one photo of a log: DB row first, then best-effort file removal. */
export function deleteLogPhoto(
  db: AppDb,
  photosDir: string,
  logId: number,
  photoId: number,
): void {
  const row = db.select().from(logPhotos).where(eq(logPhotos.id, photoId)).get();
  if (!row || row.logId !== logId) {
    throw new NotFoundError(`Photo ${photoId} not found`);
  }

  db.delete(logPhotos).where(eq(logPhotos.id, photoId)).run();

  for (const name of new Set([row.filename, row.thumbnailFilename])) {
    try {
      fs.rmSync(path.join(photosDir, name), { force: true });
    } catch {
      // best-effort — a missing file shouldn't fail the delete
    }
  }
}
