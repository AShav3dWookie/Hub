import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { albums, logPhotos } from "../db/schema.js";
import {
  MAX_PHOTOS_PER_ALBUM,
  assertPhotoAllowed,
  deletePhotoById,
  storeOnePhoto,
  toLogPhotoDTO,
  type UploadedPhoto,
} from "./logPhotosService.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import type { LogPhotoDTO } from "@logger/shared";

function assertAlbumExists(db: AppDb, albumId: number): void {
  const row = db.select({ id: albums.id }).from(albums).where(eq(albums.id, albumId)).get();
  if (!row) {
    throw new NotFoundError(`Album ${albumId} not found`);
  }
}

/**
 * Store loose photos uploaded directly to an album (logId stays null). Enforces the per-album count,
 * per-file size, and MIME limits. The one-copy invariant holds: these rows have album_id set and
 * log_id null, so they never collide with event photos in any aggregation query.
 */
export async function createAlbumPhotos(
  db: AppDb,
  photosDir: string,
  albumId: number,
  files: UploadedPhoto[],
): Promise<LogPhotoDTO[]> {
  assertAlbumExists(db, albumId);

  if (files.length === 0) {
    throw new BadRequestError("No photos provided");
  }

  const existingCount = db
    .select({ id: logPhotos.id })
    .from(logPhotos)
    .where(eq(logPhotos.albumId, albumId))
    .all().length;

  if (existingCount + files.length > MAX_PHOTOS_PER_ALBUM) {
    throw new BadRequestError(
      `An album can have at most ${MAX_PHOTOS_PER_ALBUM} loose photos (currently ${existingCount})`,
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
        logId: null,
        albumId,
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

/** Delete one loose photo of a specific album (guards that the photo actually belongs to it). */
export function deleteAlbumPhoto(
  db: AppDb,
  photosDir: string,
  albumId: number,
  photoId: number,
): void {
  const row = db.select().from(logPhotos).where(eq(logPhotos.id, photoId)).get();
  if (!row || row.albumId !== albumId) {
    throw new NotFoundError(`Photo ${photoId} not found`);
  }
  deletePhotoById(db, photosDir, photoId);
}
