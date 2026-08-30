import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog, getLogById, deleteLog } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import {
  createLogPhotos,
  deletePhotosForLog,
  deletePhotosForAlbum,
  MAX_PHOTOS_PER_ALBUM,
  type UploadedPhoto,
} from "./logPhotosService.js";
import { createAlbumPhotos, deleteAlbumPhoto } from "./albumPhotosService.js";
import { createAlbum, getAlbumById, addAlbumPerson, deleteAlbum } from "./albumService.js";
import { listGalleryPhotos } from "./galleryService.js";

async function file(name: string): Promise<UploadedPhoto> {
  const buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 7, g: 7, b: 7 } },
  })
    .png()
    .toBuffer();
  return { buffer, originalname: name, mimetype: "image/png", size: buffer.length };
}

/** filename component of a `/api/photos/<name>` url. */
function nameOf(url: string): string {
  return url.replace("/api/photos/", "");
}

describe("album photo lifecycle & the one-copy invariant", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "album-life-"));
  }

  function filesInDir(): string[] {
    return fs.existsSync(photosDir) ? fs.readdirSync(photosDir).sort() : [];
  }

  function photoRows(): Array<{ id: number; log_id: number | null; album_id: number | null; filename: string; thumbnail_filename: string }> {
    return ctx.db.$client.prepare("SELECT * FROM log_photos").all() as never;
  }

  /** Every row is an event photo XOR a loose album photo XOR an orphan — never both keys set. */
  function assertNoDoubleLinkedRows() {
    for (const r of photoRows()) {
      expect(r.log_id != null && r.album_id != null).toBe(false);
    }
  }

  function movieLog(title: string, people: { name: string }[] = []) {
    return createLog(ctx.db, {
      category: "movie",
      title,
      rating: 4,
      date: "2024-05-01",
      notes: null,
      people,
    });
  }

  // ---- The one-copy invariant --------------------------------------------------

  it("one upload = one row + one pair of files, however many albums/people reference it", async () => {
    setup();
    const alex = findOrCreateEntity(ctx.db, "person", "Alex");
    const l1 = movieLog("Heat", [{ name: "Alex" }]);
    const [photo] = await createLogPhotos(ctx.db, photosDir, l1.id, [await file("shot.png")]);

    expect(photoRows()).toHaveLength(1);
    // original + generated webp thumbnail, nothing else
    expect(filesInDir()).toEqual([nameOf(photo.url), nameOf(photo.thumbnailUrl)].sort());

    // Reference the same log/photo from two albums and add the person to one of them.
    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id] });
    const b = createAlbum(ctx.db, { title: "B", eventLogIds: [l1.id] });
    addAlbumPerson(ctx.db, a.id, { id: alex.id });

    // No new rows, no new files.
    expect(photoRows()).toHaveLength(1);
    expect(filesInDir()).toHaveLength(2);
    assertNoDoubleLinkedRows();

    // Every viewer resolves to the SAME id + SAME urls (a reference, not a copy).
    const fromLog = getLogById(ctx.db, l1.id).photos[0];
    const views = [
      listGalleryPhotos(ctx.db, {}).photos.find((p) => p.id === photo.id)!,
      listGalleryPhotos(ctx.db, { personId: alex.id }).photos[0],
      listGalleryPhotos(ctx.db, { albumId: a.id }).photos[0],
      listGalleryPhotos(ctx.db, { albumId: b.id }).photos[0],
    ];
    for (const v of views) {
      expect(v.id).toBe(photo.id);
      expect(v.url).toBe(fromLog.url);
      expect(v.thumbnailUrl).toBe(fromLog.thumbnailUrl);
    }
  });

  it("filenames stay unique across a busy multi-album / loose+event scenario; disk holds exactly 2 files per row", async () => {
    setup();
    const l1 = movieLog("Heat");
    const l2 = movieLog("Sicario");
    await createLogPhotos(ctx.db, photosDir, l1.id, [await file("a.png"), await file("b.png")]);
    await createLogPhotos(ctx.db, photosDir, l2.id, [await file("c.png")]);

    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id, l2.id] });
    const b = createAlbum(ctx.db, { title: "B", eventLogIds: [l1.id] });
    await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("loose1.png"), await file("loose2.png")]);
    await createAlbumPhotos(ctx.db, photosDir, b.id, [await file("loose3.png")]);

    const rows = photoRows();
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.filename)).size).toBe(6);
    expect(new Set(rows.map((r) => r.thumbnail_filename)).size).toBe(6);
    // original + webp thumb for each of the 6 rows
    expect(filesInDir()).toHaveLength(12);
    assertNoDoubleLinkedRows();
  });

  // ---- Deleting a loose photo through the album --------------------------------

  it("deleting a loose photo via the album removes its row and both files, and drops it from every view", async () => {
    setup();
    const a = createAlbum(ctx.db, { title: "A" });
    const [loose] = await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("loose.png")]);
    const [other] = await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("keep.png")]);

    expect(filesInDir()).toContain(nameOf(loose.url));

    deleteAlbumPhoto(ctx.db, photosDir, a.id, loose.id);

    expect(photoRows().map((r) => r.id)).toEqual([other.id]);
    expect(filesInDir()).not.toContain(nameOf(loose.url));
    expect(filesInDir()).not.toContain(nameOf(loose.thumbnailUrl));
    // the other loose photo's files are untouched
    expect(filesInDir()).toEqual([nameOf(other.url), nameOf(other.thumbnailUrl)].sort());

    expect(listGalleryPhotos(ctx.db, { albumId: a.id }).photos.map((p) => p.id)).toEqual([other.id]);
    expect(listGalleryPhotos(ctx.db, {}).photos.map((p) => p.id)).toEqual([other.id]);
  });

  it("the album route cannot delete an aggregated event photo, and the attempt leaves it fully intact", async () => {
    setup();
    const l1 = movieLog("Heat");
    const [eventPhoto] = await createLogPhotos(ctx.db, photosDir, l1.id, [await file("ev.png")]);
    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id] });
    const filesBefore = filesInDir();

    expect(() => deleteAlbumPhoto(ctx.db, photosDir, a.id, eventPhoto.id)).toThrow(/not found/i);

    expect(getLogById(ctx.db, l1.id).photos.map((p) => p.id)).toEqual([eventPhoto.id]);
    expect(filesInDir()).toEqual(filesBefore);
    expect(listGalleryPhotos(ctx.db, { albumId: a.id }).photos.map((p) => p.id)).toContain(eventPhoto.id);
  });

  it("cannot delete album A's loose photo via album B; 404 for a missing photo", async () => {
    setup();
    const a = createAlbum(ctx.db, { title: "A" });
    const b = createAlbum(ctx.db, { title: "B" });
    const [loose] = await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("l.png")]);

    expect(() => deleteAlbumPhoto(ctx.db, photosDir, b.id, loose.id)).toThrow(/not found/i);
    expect(() => deleteAlbumPhoto(ctx.db, photosDir, a.id, 99999)).toThrow(/not found/i);
    // still there
    expect(photoRows().map((r) => r.id)).toEqual([loose.id]);
    expect(filesInDir()).toHaveLength(2);
  });

  // ---- Deleting the whole album ----------------------------------------------

  it("deleting an album with ?deletePhotos removes only its loose photos; linked events keep theirs", async () => {
    setup();
    const l1 = movieLog("Heat");
    await createLogPhotos(ctx.db, photosDir, l1.id, [await file("ev1.png"), await file("ev2.png")]);
    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id] });
    await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("l1.png"), await file("l2.png")]);
    expect(photoRows()).toHaveLength(4);

    // mirrors the route: deletePhotosForAlbum(...) then deleteAlbum(...)
    deletePhotosForAlbum(ctx.db, photosDir, a.id);
    deleteAlbum(ctx.db, a.id);

    // the two event photos survive as normal log photos
    expect(getLogById(ctx.db, l1.id).photos).toHaveLength(2);
    expect(photoRows()).toHaveLength(2);
    expect(filesInDir()).toHaveLength(4);
    assertNoDoubleLinkedRows();
  });

  it("deleting an album without ?deletePhotos keeps its loose photos as gallery orphans", async () => {
    setup();
    const a = createAlbum(ctx.db, { title: "A" });
    const [loose] = await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("l.png")]);

    deleteAlbum(ctx.db, a.id);

    const row = ctx.db.$client
      .prepare("SELECT log_id, album_id FROM log_photos WHERE id = ?")
      .get(loose.id) as { log_id: number | null; album_id: number | null };
    expect(row).toMatchObject({ log_id: null, album_id: null });

    const gallery = listGalleryPhotos(ctx.db, {}).photos;
    expect(gallery.map((p) => p.id)).toEqual([loose.id]);
    expect(gallery[0].log).toBeNull();
    expect(filesInDir()).toEqual([nameOf(loose.url), nameOf(loose.thumbnailUrl)].sort());
  });

  it("deleting an album cascades album_events / album_people but never touches the events or people", async () => {
    setup();
    const l1 = movieLog("Heat", [{ name: "Sam" }]);
    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id], people: [{ name: "Alex" }] });

    deleteAlbum(ctx.db, a.id);

    expect(ctx.db.$client.prepare("SELECT count(*) c FROM album_events").get()).toMatchObject({ c: 0 });
    expect(ctx.db.$client.prepare("SELECT count(*) c FROM album_people").get()).toMatchObject({ c: 0 });
    // the log and its person tag are untouched
    const log = getLogById(ctx.db, l1.id);
    expect(log.people.map((p) => p.name)).toEqual(["Sam"]);
    expect(log.albums).toEqual([]);
  });

  // ---- Deleting a linked event's log ----------------------------------------

  it("deleting a linked log with its photos clears it from the album; loose photos survive", async () => {
    setup();
    const l1 = movieLog("Heat");
    await createLogPhotos(ctx.db, photosDir, l1.id, [await file("ev.png")]);
    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id] });
    const [loose] = await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("l.png")]);

    // mirrors DELETE /api/logs/:id?deletePhotos=true
    deletePhotosForLog(ctx.db, photosDir, l1.id);
    deleteLog(ctx.db, l1.id);

    expect(getAlbumById(ctx.db, a.id).eventCount).toBe(0);
    expect(listGalleryPhotos(ctx.db, { albumId: a.id }).photos.map((p) => p.id)).toEqual([loose.id]);
    expect(photoRows().map((r) => r.id)).toEqual([loose.id]);
    expect(filesInDir()).toEqual([nameOf(loose.url), nameOf(loose.thumbnailUrl)].sort());
  });

  it("deleting a linked log but keeping its photos orphans them out of the album, still in the gallery", async () => {
    setup();
    const l1 = movieLog("Heat");
    const [ev] = await createLogPhotos(ctx.db, photosDir, l1.id, [await file("ev.png")]);
    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id] });
    const [loose] = await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("l.png")]);

    deleteLog(ctx.db, l1.id); // no deletePhotosForLog

    expect(getAlbumById(ctx.db, a.id).eventCount).toBe(0);
    // the ex-event photo is now a plain orphan — gone from the album, still in the gallery
    expect(listGalleryPhotos(ctx.db, { albumId: a.id }).photos.map((p) => p.id)).toEqual([loose.id]);
    expect(listGalleryPhotos(ctx.db, {}).photos.map((p) => p.id).sort()).toEqual([ev.id, loose.id].sort());
    const orphan = ctx.db.$client
      .prepare("SELECT log_id, album_id FROM log_photos WHERE id = ?")
      .get(ev.id) as { log_id: number | null; album_id: number | null };
    expect(orphan).toMatchObject({ log_id: null, album_id: null });
    expect(filesInDir()).toHaveLength(4);
  });

  // ---- Counts & caps -------------------------------------------------------

  it("photoCount tracks loose + linked-event photos and updates on delete", async () => {
    setup();
    const l1 = movieLog("Heat");
    await createLogPhotos(ctx.db, photosDir, l1.id, [await file("e1.png"), await file("e2.png")]);
    const a = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id] });
    expect(getAlbumById(ctx.db, a.id).photoCount).toBe(2);

    const [loose] = await createAlbumPhotos(ctx.db, photosDir, a.id, [await file("l.png")]);
    expect(getAlbumById(ctx.db, a.id).photoCount).toBe(3);

    deleteAlbumPhoto(ctx.db, photosDir, a.id, loose.id);
    expect(getAlbumById(ctx.db, a.id).photoCount).toBe(2);
  });

  it("rejects a loose upload that would exceed MAX_PHOTOS_PER_ALBUM, writing nothing", async () => {
    setup();
    const a = createAlbum(ctx.db, { title: "A" });
    const stmt = ctx.db.$client.prepare(
      "INSERT INTO log_photos (album_id, filename, thumbnail_filename, original_name, mime_type, size) VALUES (?,?,?,?,?,?)",
    );
    for (let i = 0; i < MAX_PHOTOS_PER_ALBUM - 1; i++) {
      stmt.run(a.id, `seed-${i}.png`, `seed-${i}.webp`, "o.png", "image/png", 1);
    }

    await expect(
      createAlbumPhotos(ctx.db, photosDir, a.id, [await file("x.png"), await file("y.png")]),
    ).rejects.toThrow(/at most/i);
    expect(filesInDir()).toHaveLength(0);
    expect(ctx.db.$client.prepare("SELECT count(*) c FROM log_photos WHERE album_id = ?").get(a.id)).toMatchObject({
      c: MAX_PHOTOS_PER_ALBUM - 1,
    });

    // one more is still allowed (fills to exactly the cap)
    await expect(
      createAlbumPhotos(ctx.db, photosDir, a.id, [await file("z.png")]),
    ).resolves.toHaveLength(1);
  });
});
