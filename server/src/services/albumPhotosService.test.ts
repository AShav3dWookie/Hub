import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { logPhotos } from "../db/schema.js";
import { createAlbum } from "./albumService.js";
import { createAlbumPhotos, deleteAlbumPhoto } from "./albumPhotosService.js";
import { MAX_PHOTOS_PER_ALBUM, type UploadedPhoto } from "./logPhotosService.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

async function file(name: string): Promise<UploadedPhoto> {
  const buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  return { buffer, originalname: name, mimetype: "image/png", size: buffer.length };
}

/**
 * Guard branches of the loose-album-photo upload. The happy paths and the one-copy invariant
 * are covered by albumPhotoLifecycle.test.ts and albumPhotos.dedup.test.ts; these are the
 * rejections, which nothing reached before.
 */
describe("createAlbumPhotos guards", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-album-photos-"));
    return ctx.db;
  }

  const newAlbum = (db: ReturnType<typeof setup>) =>
    createAlbum(db, { title: "Rome trip", notes: null, dateStart: null, dateEnd: null });

  /** Insert loose album photo rows without going through the image pipeline. */
  function seedLoosePhotos(db: ReturnType<typeof setup>, albumId: number, count: number) {
    for (let i = 0; i < count; i++) {
      db.insert(logPhotos)
        .values({
          logId: null,
          albumId,
          filename: `seed-${albumId}-${i}.jpg`,
          thumbnailFilename: `seed-${albumId}-${i}_thumb.webp`,
          originalName: `seed-${i}.jpg`,
          mimeType: "image/jpeg",
          size: 128,
        })
        .run();
    }
  }

  it("rejects an upload to an album that does not exist", async () => {
    const db = setup();
    await expect(createAlbumPhotos(db, photosDir, 9999, [await file("a.png")])).rejects.toThrow(
      NotFoundError,
    );
  });

  it("names the missing album in the error", async () => {
    const db = setup();
    await expect(createAlbumPhotos(db, photosDir, 9999, [await file("a.png")])).rejects.toThrow(
      /Album 9999 not found/,
    );
  });

  it("checks the album exists before it looks at the files", async () => {
    const db = setup();
    // An empty file list would also be rejected; the album check must win, so a typo in the
    // album id never reports itself as "no photos provided".
    await expect(createAlbumPhotos(db, photosDir, 9999, [])).rejects.toThrow(NotFoundError);
  });

  it("rejects an upload with no files", async () => {
    const db = setup();
    const album = newAlbum(db);
    await expect(createAlbumPhotos(db, photosDir, album.id, [])).rejects.toThrow(BadRequestError);
    await expect(createAlbumPhotos(db, photosDir, album.id, [])).rejects.toThrow(
      /No photos provided/,
    );
  });

  it("rejects a batch that would push an album past the limit, counting what is already there", async () => {
    const db = setup();
    const album = newAlbum(db);
    seedLoosePhotos(db, album.id, MAX_PHOTOS_PER_ALBUM - 1);

    // One more is fine; two would exceed. This is the cumulative check across requests, which
    // multer's own per-request file cap cannot see.
    await expect(
      createAlbumPhotos(db, photosDir, album.id, [await file("a.png"), await file("b.png")]),
    ).rejects.toThrow(/at most 100 loose photos or videos/);
  });

  it("reports how many the album already has", async () => {
    const db = setup();
    const album = newAlbum(db);
    seedLoosePhotos(db, album.id, MAX_PHOTOS_PER_ALBUM);

    await expect(createAlbumPhotos(db, photosDir, album.id, [await file("a.png")])).rejects.toThrow(
      /currently 100/,
    );
  });

  it("writes nothing when the batch is rejected for being over the limit", async () => {
    const db = setup();
    const album = newAlbum(db);
    seedLoosePhotos(db, album.id, MAX_PHOTOS_PER_ALBUM);

    await expect(
      createAlbumPhotos(db, photosDir, album.id, [await file("a.png")]),
    ).rejects.toThrow();

    expect(db.select().from(logPhotos).all()).toHaveLength(MAX_PHOTOS_PER_ALBUM);
    expect(fs.readdirSync(photosDir)).toEqual([]);
  });

  it("accepts a batch that lands exactly on the limit", async () => {
    const db = setup();
    const album = newAlbum(db);
    seedLoosePhotos(db, album.id, MAX_PHOTOS_PER_ALBUM - 1);

    const created = await createAlbumPhotos(db, photosDir, album.id, [await file("a.png")]);
    expect(created).toHaveLength(1);
  });

  it("counts only the album's own loose photos towards its limit", async () => {
    const db = setup();
    const album = newAlbum(db);
    const other = createAlbum(db, {
      title: "Paris trip",
      notes: null,
      dateStart: null,
      dateEnd: null,
    });
    seedLoosePhotos(db, other.id, MAX_PHOTOS_PER_ALBUM);

    const created = await createAlbumPhotos(db, photosDir, album.id, [await file("a.png")]);
    expect(created).toHaveLength(1);
  });
});

describe("deleteAlbumPhoto guards", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  it("reports a 404 for a photo that does not exist", () => {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-album-photos-"));
    const album = createAlbum(ctx.db, {
      title: "Rome trip",
      notes: null,
      dateStart: null,
      dateEnd: null,
    });

    expect(() => deleteAlbumPhoto(ctx.db, photosDir, album.id, 9999)).toThrow(NotFoundError);
  });
});
