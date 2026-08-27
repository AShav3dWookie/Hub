import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog, deleteLog } from "./logService.js";
import { createLogPhotos, type UploadedPhoto } from "./logPhotosService.js";
import { listGalleryPhotos } from "./galleryService.js";

async function file(name = "photo.png"): Promise<UploadedPhoto> {
  const buffer = await sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  return { buffer, originalname: name, mimetype: "image/png", size: buffer.length };
}

describe("galleryService", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-"));
  }

  function movieLog(title: string) {
    return createLog(ctx.db, {
      category: "movie",
      title,
      rating: 4,
      date: "2024-03-03",
      notes: null,
      people: [{ name: "Sam" }],
    });
  }

  it("returns photos newest-first with their log + entity context", async () => {
    setup();
    const a = movieLog("Heat");
    const b = movieLog("Sicario");
    await createLogPhotos(ctx.db, photosDir, a.id, [await file("a1.png")]);
    await createLogPhotos(ctx.db, photosDir, b.id, [await file("b1.png"), await file("b2.png")]);

    const { photos, nextCursor } = listGalleryPhotos(ctx.db);

    expect(photos.map((p) => p.originalName)).toEqual(["b2.png", "b1.png", "a1.png"]);
    expect(nextCursor).toBeNull();
    expect(photos[0].log).toMatchObject({ id: b.id, entityId: b.entityId, entityTitle: "Sicario", category: "movie", date: "2024-03-03" });
    expect(photos[0].url).toMatch(/^\/api\/photos\//);
  });

  it("paginates with an integer cursor and no overlap", async () => {
    setup();
    const log = movieLog("Heat");
    await createLogPhotos(
      ctx.db,
      photosDir,
      log.id,
      await Promise.all(Array.from({ length: 5 }, (_, i) => file(`p${i}.png`))),
    );

    const page1 = listGalleryPhotos(ctx.db, { limit: 2 });
    expect(page1.photos).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listGalleryPhotos(ctx.db, { limit: 2, cursor: page1.nextCursor! });
    const page3 = listGalleryPhotos(ctx.db, { limit: 2, cursor: page2.nextCursor! });

    const ids = [...page1.photos, ...page2.photos, ...page3.photos].map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
    expect(page3.nextCursor).toBeNull();
  });

  it("returns log: null for a photo whose log was deleted", async () => {
    setup();
    const log = movieLog("Heat");
    await createLogPhotos(ctx.db, photosDir, log.id, [await file()]);

    deleteLog(ctx.db, log.id); // keeps the photo (orphan)

    const { photos } = listGalleryPhotos(ctx.db);
    expect(photos).toHaveLength(1);
    expect(photos[0].log).toBeNull();
    expect(photos[0].logId).toBeNull();
  });
});
