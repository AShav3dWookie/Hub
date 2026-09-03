import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { eq, inArray, asc } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { logs, logPhotos } from "../db/schema.js";
import { getEntityById } from "./entityService.js";
import { extractPosterFrame } from "../lib/videoPoster.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_BATCH_BYTES,
  MAX_VIDEOS_PER_UPLOAD,
  categorySupportsPhotos,
  extForMime,
  isAllowedMediaMime,
  maxBytesForMime,
  mediaKindForMime,
} from "@logger/shared";
import type { LogPhotoDTO } from "@logger/shared";

export const MAX_PHOTOS_PER_LOG = 10;
export const MAX_PHOTOS_PER_ALBUM = 100;
const THUMBNAIL_SIZE = 400;

/**
 * Back-compat re-exports — the media allow-list and image size cap now live in
 * `@logger/shared` so the client shares them. Prefer importing from there directly.
 */
export { ALLOWED_IMAGE_MIME_TYPES as ALLOWED_PHOTO_MIME_TYPES, MAX_IMAGE_BYTES as MAX_PHOTO_BYTES };

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
    kind: mediaKindForMime(row.mimeType),
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
 * Guard: the log must exist and its parent entity's category must support photos/videos
 * (see categorySupportsPhotos — currently Movie / Eating Out / Hang Out). This is the
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

/** Validate one upload against the MIME allow-list + the per-type size cap. */
export function assertMediaAllowed(file: UploadedPhoto): void {
  if (!isAllowedMediaMime(file.mimetype)) {
    throw new BadRequestError(`Unsupported file type: ${file.mimetype}`);
  }
  if (file.size > maxBytesForMime(file.mimetype)) {
    const limit = mediaKindForMime(file.mimetype) === "video" ? "Each video must be 250MB" : "Each photo must be 10MB";
    throw new BadRequestError(`${limit} or smaller`);
  }
}

/**
 * Bound the in-RAM cost of one upload request (multer buffers every part before we run).
 * A `Content-Length` gate in the route rejects the worst case earlier; this is the
 * authoritative check once the bytes are parsed.
 */
export function assertUploadBatchWithinBudget(files: UploadedPhoto[]): void {
  const videoCount = files.filter((f) => mediaKindForMime(f.mimetype) === "video").length;
  if (videoCount > MAX_VIDEOS_PER_UPLOAD) {
    throw new BadRequestError(`At most ${MAX_VIDEOS_PER_UPLOAD} videos per upload`);
  }
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_UPLOAD_BATCH_BYTES) {
    throw new BadRequestError("That upload is too large — send fewer or smaller files");
  }
}

/** Resize an image buffer to the thumbnail box and write it as webp. */
async function writeWebpThumbnail(source: Buffer, outPath: string): Promise<void> {
  await sharp(source)
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outPath);
}

/**
 * A generic dark "play" tile, used as a video's poster when ffmpeg is unavailable or can't
 * decode the file. Keeps the invariant that a video's thumbnailFilename is always a real webp
 * (never the video itself, which the client would try to render in an <img>).
 */
async function writePlaceholderPoster(outPath: string): Promise<void> {
  const w = THUMBNAIL_SIZE;
  const h = Math.round((THUMBNAIL_SIZE * 3) / 4);
  const triangle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<polygon points="${w / 2 - 28},${h / 2 - 34} ${w / 2 - 28},${h / 2 + 34} ${w / 2 + 34},${h / 2}" ` +
      `fill="#ffffff" fill-opacity="0.85"/></svg>`,
  );
  await sharp({ create: { width: w, height: h, channels: 4, background: "#1e293b" } })
    .composite([{ input: triangle }])
    .webp({ quality: 80 })
    .toFile(outPath);
}

/**
 * Write one uploaded file to `photosDir`: the original under a random filename, plus a
 * `<uuid>_thumb.webp` thumbnail.
 *
 * - Images: a best-effort resized webp (falls back to serving the original if sharp can't
 *   decode the format, e.g. HEIC without libheif).
 * - Videos: a poster frame decoded by ffmpeg and run through the same resize recipe, or a
 *   generated placeholder tile if ffmpeg is missing / fails. A video's thumbnail is always a
 *   real webp.
 *
 * Shared by the log-photo and album-photo upload paths.
 */
export async function storeOnePhoto(
  photosDir: string,
  file: UploadedPhoto,
): Promise<{ filename: string; thumbnailFilename: string }> {
  fs.mkdirSync(photosDir, { recursive: true });

  const ext = extForMime(file.mimetype);
  const base = randomUUID();
  const filename = `${base}.${ext}`;
  const originalPath = path.join(photosDir, filename);
  fs.writeFileSync(originalPath, file.buffer);

  const generated = `${base}_thumb.webp`;
  const thumbPath = path.join(photosDir, generated);

  if (mediaKindForMime(file.mimetype) === "video") {
    try {
      const frame = await extractPosterFrame(originalPath);
      await writeWebpThumbnail(frame, thumbPath);
    } catch {
      await writePlaceholderPoster(thumbPath);
    }
    return { filename, thumbnailFilename: generated };
  }

  try {
    await writeWebpThumbnail(file.buffer, thumbPath);
    return { filename, thumbnailFilename: generated };
  } catch {
    return { filename, thumbnailFilename: filename };
  }
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
 * resized thumbnail, plus a DB row per photo/video. Enforces the per-log count, per-file
 * size, per-request budget, and MIME-type limits. Returns the created attachments as DTOs.
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
      `A log can have at most ${MAX_PHOTOS_PER_LOG} photos or videos (currently ${existingCount})`,
    );
  }

  assertUploadBatchWithinBudget(files);
  for (const file of files) {
    assertMediaAllowed(file);
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
