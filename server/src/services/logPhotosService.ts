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
export const MAX_PHOTOS_PER_ALBUM = 100;
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
    if (row.logId == null) continue; // filtered out by the query, but narrows the type
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

/** Validate one upload against the MIME + size limits. */
export function assertPhotoAllowed(file: UploadedPhoto): void {
  if (!ALLOWED_PHOTO_MIME_TYPES[file.mimetype]) {
    throw new BadRequestError(`Unsupported image type: ${file.mimetype}`);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new BadRequestError("Each photo must be 10MB or smaller");
  }
}

/**
 * Write one uploaded file to `photosDir`: the original under a random filename, plus a
 * best-effort resized webp thumbnail (falls back to the original if sharp can't decode
 * the format). Shared by the log-photo and album-photo upload paths.
 */
export async function storeOnePhoto(
  photosDir: string,
  file: UploadedPhoto,
): Promise<{ filename: string; thumbnailFilename: string }> {
  fs.mkdirSync(photosDir, { recursive: true });

  const ext = ALLOWED_PHOTO_MIME_TYPES[file.mimetype];
  const base = randomUUID();
  const filename = `${base}.${ext}`;
  fs.writeFileSync(path.join(photosDir, filename), file.buffer);

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

  return { filename, thumbnailFilename };
}

/** Delete every photo belonging to an album (rows + files). Mirrors deletePhotosForLog. */
export function deletePhotosForAlbum(db: AppDb, photosDir: string, albumId: number): void {
  const rows = db.select().from(logPhotos).where(eq(logPhotos.albumId, albumId)).all();
  if (rows.length === 0) return;
  db.delete(logPhotos).where(eq(logPhotos.albumId, albumId)).run();
  removePhotoFiles(
    photosDir,
    rows.flatMap((r) => [r.filename, r.thumbnailFilename]),
  );
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
    assertPhotoAllowed(file);
  }

  const created: LogPhotoDTO[] = [];
  for (const file of files) {
    const { filename, thumbnailFilename } = await storeOnePhoto(photosDir, file);
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

function removePhotoFiles(photosDir: string, filenames: string[]): void {
  for (const name of new Set(filenames)) {
    try {
      fs.rmSync(path.join(photosDir, name), { force: true });
    } catch {
      // best-effort — a missing file shouldn't fail the delete
    }
  }
}

/** Delete one photo by id (any log, or an orphan): DB row first, then best-effort file removal. */
export function deletePhotoById(db: AppDb, photosDir: string, photoId: number): void {
  const row = db.select().from(logPhotos).where(eq(logPhotos.id, photoId)).get();
  if (!row) {
    throw new NotFoundError(`Photo ${photoId} not found`);
  }
  db.delete(logPhotos).where(eq(logPhotos.id, photoId)).run();
  removePhotoFiles(photosDir, [row.filename, row.thumbnailFilename]);
}

/** Delete one photo of a specific log (guards that the photo actually belongs to that log). */
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
  deletePhotoById(db, photosDir, photoId);
}

/** Delete every photo belonging to a log (rows + files). Used when a log is deleted "with photos". */
export function deletePhotosForLog(db: AppDb, photosDir: string, logId: number): void {
  const rows = db.select().from(logPhotos).where(eq(logPhotos.logId, logId)).all();
  if (rows.length === 0) return;
  db.delete(logPhotos).where(eq(logPhotos.logId, logId)).run();
  removePhotoFiles(
    photosDir,
    rows.flatMap((r) => [r.filename, r.thumbnailFilename]),
  );
}
