import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog, deleteLog } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { logPhotos } from "../db/schema.js";
import {
  createLogPhotos,
  deleteLogPhoto,
  deletePhotoById,
  deletePhotosForLog,
  listLogPhotos,
  assertLogSupportsPhotos,
  type UploadedPhoto,
} from "./logPhotosService.js";

async function makePng(size = 32): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

async function file(name = "photo.png"): Promise<UploadedPhoto> {
  const buffer = await makePng();
  return { buffer, originalname: name, mimetype: "image/png", size: buffer.length };
}

describe("logPhotosService", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "logphotos-"));
  }

  function movieLog() {
    return createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Sam" }],
    });
  }

  it("stores the original + a thumbnail and inserts a DB row", async () => {
    setup();
    const log = movieLog();

    const created = await createLogPhotos(ctx.db, photosDir, log.id, [await file("beach.png")]);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ logId: log.id, originalName: "beach.png" });
    expect(created[0].url).toMatch(/^\/api\/photos\/[\w-]+\.png$/);
    expect(created[0].thumbnailUrl).toMatch(/^\/api\/photos\/[\w-]+_thumb\.webp$/);

    const onDisk = fs.readdirSync(photosDir).sort();
    expect(onDisk).toHaveLength(2); // original + thumbnail
    for (const f of onDisk) {
      expect(fs.statSync(path.join(photosDir, f)).size).toBeGreaterThan(0);
    }

    expect(listLogPhotos(ctx.db, log.id)).toHaveLength(1);
  });

  it("returns the log's photos on the LogDTO via getLogById", async () => {
    setup();
    const log = movieLog();
    await createLogPhotos(ctx.db, photosDir, log.id, [await file(), await file()]);

    const { getLogById } = await import("./logService.js");
    const fetched = getLogById(ctx.db, log.id);
    expect(fetched.photos).toHaveLength(2);
  });

  it("rejects categories without people-tagging", async () => {
    setup();
    for (const category of ["tv", "book", "game"] as const) {
      const log = createLog(ctx.db, {
        category,
        title: `A ${category}`,
        rating: 3,
        date: "2024-01-01",
        notes: null,
        people: [],
      });
      await expect(createLogPhotos(ctx.db, photosDir, log.id, [await file()])).rejects.toThrow(
        /cannot have photos/i,
      );
    }
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
  });

  it("accepts photos for eating_out logs", async () => {
    setup();
    const entity = findOrCreateEntity(ctx.db, "eating_out", "Joe's Pizza");
    const log = createLog(ctx.db, {
      entityId: entity.id,
      rating: 4,
      date: "2024-02-02",
      notes: null,
      people: [{ name: "Pat" }],
    });
    const created = await createLogPhotos(ctx.db, photosDir, log.id, [await file()]);
    expect(created).toHaveLength(1);
  });

  it("enforces the 10-photos-per-log limit", async () => {
    setup();
    const log = movieLog();
    const eight = await Promise.all(Array.from({ length: 8 }, () => file()));
    await createLogPhotos(ctx.db, photosDir, log.id, eight);

    const three = await Promise.all(Array.from({ length: 3 }, () => file()));
    await expect(createLogPhotos(ctx.db, photosDir, log.id, three)).rejects.toThrow(/at most 10/i);

    expect(listLogPhotos(ctx.db, log.id)).toHaveLength(8);
  });

  it("rejects unsupported mime types and oversized files", async () => {
    setup();
    const log = movieLog();
    const good = await file();

    await expect(
      createLogPhotos(ctx.db, photosDir, log.id, [{ ...good, mimetype: "image/gif" }]),
    ).rejects.toThrow(/unsupported file type/i);

    await expect(
      createLogPhotos(ctx.db, photosDir, log.id, [{ ...good, size: 11 * 1024 * 1024 }]),
    ).rejects.toThrow(/10MB/i);
  });

  it("rejects non-mp4 video types", async () => {
    setup();
    const log = movieLog();
    const good = await file();
    await expect(
      createLogPhotos(ctx.db, photosDir, log.id, [
        { ...good, originalname: "clip.mov", mimetype: "video/quicktime" },
      ]),
    ).rejects.toThrow(/unsupported file type/i);
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
  });

  it("stores an mp4 video with a webp poster and kind:'video'", async () => {
    setup();
    const log = movieLog();
    // A bogus buffer + FFMPEG_PATH override forces the placeholder-poster fallback path;
    // the invariant we care about is that the thumbnail is always a real webp.
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = path.join(os.tmpdir(), "definitely-not-ffmpeg");
    try {
      const buffer = Buffer.from("not really an mp4");
      const [video] = await createLogPhotos(ctx.db, photosDir, log.id, [
        { buffer, originalname: "clip.mp4", mimetype: "video/mp4", size: buffer.length },
      ]);

      expect(video.kind).toBe("video");
      expect(video.url).toMatch(/^\/api\/photos\/[\w-]+\.mp4$/);
      expect(video.thumbnailUrl).toMatch(/^\/api\/photos\/[\w-]+_thumb\.webp$/);

      const onDisk = fs.readdirSync(photosDir).sort();
      expect(onDisk).toHaveLength(2); // original + poster
      const posterName = onDisk.find((f) => f.endsWith("_thumb.webp"))!;
      const meta = await sharp(fs.readFileSync(path.join(photosDir, posterName))).metadata();
      expect(meta.format).toBe("webp");
    } finally {
      if (prev == null) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prev;
    }
  });

  it("rejects a video over 250MB and reports the video limit", async () => {
    setup();
    const log = movieLog();
    const buffer = Buffer.from("x");
    await expect(
      createLogPhotos(ctx.db, photosDir, log.id, [
        { buffer, originalname: "big.mp4", mimetype: "video/mp4", size: 251 * 1024 * 1024 },
      ]),
    ).rejects.toThrow(/video must be 250MB/i);
  });

  it("rejects an upload whose combined size blows the per-request budget", async () => {
    setup();
    const log = movieLog();
    const fourBigVideos = Array.from({ length: 4 }, (_, i) => ({
      buffer: Buffer.from("x"),
      originalname: `v${i}.mp4`,
      mimetype: "video/mp4",
      size: 250 * 1024 * 1024, // 1 GB total > 900 MB budget
    }));
    await expect(createLogPhotos(ctx.db, photosDir, log.id, fourBigVideos)).rejects.toThrow(
      /upload is too large/i,
    );
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
  });

  it("assertUploadBatchWithinBudget caps the video count per request", async () => {
    const { assertUploadBatchWithinBudget } = await import("./logPhotosService.js");
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      buffer: Buffer.from("x"),
      originalname: `v${i}.mp4`,
      mimetype: "video/mp4",
      size: 1000,
    }));
    expect(() => assertUploadBatchWithinBudget(eleven)).toThrow(/at most 10 videos/i);
  });

  it("deletes a photo's row and files", async () => {
    setup();
    const log = movieLog();
    const [photo] = await createLogPhotos(ctx.db, photosDir, log.id, [await file()]);
    expect(fs.readdirSync(photosDir)).toHaveLength(2);

    deleteLogPhoto(ctx.db, photosDir, log.id, photo.id);

    expect(listLogPhotos(ctx.db, log.id)).toHaveLength(0);
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
  });

  it("404s when deleting a photo that doesn't belong to the log", async () => {
    setup();
    const log = movieLog();
    const [photo] = await createLogPhotos(ctx.db, photosDir, log.id, [await file()]);
    const other = movieLog();
    expect(() => deleteLogPhoto(ctx.db, photosDir, other.id, photo.id)).toThrow(/not found/i);
  });

  it("orphans photo rows (logId -> null) when the parent log is deleted", async () => {
    setup();
    const log = movieLog();
    const created = await createLogPhotos(ctx.db, photosDir, log.id, [await file(), await file()]);

    deleteLog(ctx.db, log.id);

    const stillLinked = ctx.db.select().from(logPhotos).where(eq(logPhotos.logId, log.id)).all();
    expect(stillLinked).toHaveLength(0);

    const all = ctx.db.select().from(logPhotos).all();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.logId === null)).toBe(true);
    // files are left on disk — the gallery still serves them
    expect(fs.readdirSync(photosDir).length).toBeGreaterThanOrEqual(created.length);
  });

  it("deletePhotosForLog removes every row + file for a log", async () => {
    setup();
    const log = movieLog();
    await createLogPhotos(ctx.db, photosDir, log.id, [await file(), await file(), await file()]);
    expect(fs.readdirSync(photosDir).length).toBeGreaterThan(0);

    deletePhotosForLog(ctx.db, photosDir, log.id);

    expect(ctx.db.select().from(logPhotos).all()).toHaveLength(0);
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
  });

  it("deletePhotoById removes an orphaned photo (row + files)", async () => {
    setup();
    const log = movieLog();
    const [photo] = await createLogPhotos(ctx.db, photosDir, log.id, [await file()]);
    deleteLog(ctx.db, log.id); // orphan it

    deletePhotoById(ctx.db, photosDir, photo.id);

    expect(ctx.db.select().from(logPhotos).all()).toHaveLength(0);
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
    expect(() => deletePhotoById(ctx.db, photosDir, photo.id)).toThrow(/not found/i);
  });

  it("assertLogSupportsPhotos throws for a missing log", () => {
    setup();
    expect(() => assertLogSupportsPhotos(ctx.db, 999999)).toThrow(/not found/i);
  });
});
