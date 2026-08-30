import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog, updateLog } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { createLogPhotos, type UploadedPhoto } from "./logPhotosService.js";
import { createAlbumPhotos } from "./albumPhotosService.js";
import { createAlbum, addAlbumEvent, addAlbumPerson } from "./albumService.js";
import { listGalleryPhotos, type GalleryQuery } from "./galleryService.js";

async function file(name: string): Promise<UploadedPhoto> {
  const buffer = await sharp({
    create: { width: 12, height: 12, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .png()
    .toBuffer();
  return { buffer, originalname: name, mimetype: "image/png", size: buffer.length };
}

/** Walk every page of a scoped gallery query, returning the flattened photo id list. */
function walkAll(db: Parameters<typeof listGalleryPhotos>[0], query: GalleryQuery): number[] {
  const ids: number[] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = listGalleryPhotos(db, { ...query, cursor });
    ids.push(...page.photos.map((p) => p.id));
    if (page.nextCursor == null) break;
    cursor = page.nextCursor;
  }
  return ids;
}

function unique(ids: number[]): boolean {
  return new Set(ids).size === ids.length;
}

describe("photo de-duplication across linkage paths", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  /**
   * Fixture:
   *  - album A links events L1 (movie) and L2 (hang_out)
   *  - person P is added directly to A; person Q is only tagged on L1
   *  - photos: p1,p2 on L1 · p3 on L2 · p4,p5 loose on A · p6 on an unlinked log L3
   */
  async function fixture() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "dedup-"));
    const db = ctx.db;

    const q = findOrCreateEntity(db, "person", "Q");
    const l1 = createLog(db, {
      category: "movie",
      title: "Heat",
      rating: 5,
      date: "2024-06-01",
      notes: null,
      people: [{ id: q.id }],
    });
    const l2 = createLog(db, {
      category: "hang_out",
      title: "Beach day",
      rating: null,
      date: "2024-06-02",
      notes: null,
      people: [],
    });
    const l3 = createLog(db, {
      category: "movie",
      title: "Sicario",
      rating: 4,
      date: "2024-06-03",
      notes: null,
      people: [],
    });

    const [p1] = await createLogPhotos(db, photosDir, l1.id, [await file("p1.png")]);
    const [p2] = await createLogPhotos(db, photosDir, l1.id, [await file("p2.png")]);
    const [p3] = await createLogPhotos(db, photosDir, l2.id, [await file("p3.png")]);
    const [p6] = await createLogPhotos(db, photosDir, l3.id, [await file("p6.png")]);

    const album = createAlbum(db, {
      title: "Trip",
      eventLogIds: [l1.id, l2.id],
      people: [{ name: "P" }],
    });
    const [p4, p5] = await createAlbumPhotos(db, photosDir, album.id, [
      await file("p4.png"),
      await file("p5.png"),
    ]);

    const p = getAlbumPerson(db, album.id, "P");
    return { db, album, l1, l2, l3, p, q, ids: { p1: p1.id, p2: p2.id, p3: p3.id, p4: p4.id, p5: p5.id, p6: p6.id } };
  }

  function getAlbumPerson(db: Parameters<typeof listGalleryPhotos>[0], albumId: number, name: string) {
    const people = addAlbumPerson(db, albumId, { name }); // idempotent — returns the union
    return people.find((x) => x.name === name)!;
  }

  it("album stream returns every album photo exactly once, newest-first, no unlinked photo", async () => {
    const { db, album, ids } = await fixture();
    const walked = walkAll(db, { albumId: album.id });

    expect(walked.sort()).toEqual([ids.p1, ids.p2, ids.p3, ids.p4, ids.p5].sort());
    expect(walked).not.toContain(ids.p6);
    expect(unique(walked)).toBe(true);
    // Default single page is newest-first.
    const single = listGalleryPhotos(db, { albumId: album.id }).photos.map((p) => p.id);
    expect(single).toEqual([...single].sort((a, b) => b - a));
  });

  it("linking the same event twice does not duplicate its photos", async () => {
    const { db, album, l1, ids } = await fixture();
    addAlbumEvent(db, album.id, l1.id);
    const walked = walkAll(db, { albumId: album.id });
    expect(walked.filter((id) => id === ids.p1 || id === ids.p2)).toHaveLength(2);
    expect(unique(walked)).toBe(true);
  });

  it("a photo on a log linked to two albums appears once per album", async () => {
    const { db, album, l1, ids } = await fixture();
    const albumB = createAlbum(db, { title: "Second", eventLogIds: [l1.id] });
    const a = walkAll(db, { albumId: album.id });
    const b = walkAll(db, { albumId: albumB.id });
    expect(a.filter((id) => id === ids.p1)).toHaveLength(1);
    expect(b.filter((id) => id === ids.p1)).toHaveLength(1);
  });

  it("a loose album photo has log:null and never matches the event branch", async () => {
    const { db, album, ids } = await fixture();
    const loose = listGalleryPhotos(db, { albumId: album.id }).photos.find((p) => p.id === ids.p4)!;
    expect(loose.log).toBeNull();
  });

  it("tagging the album's direct person onto a linked event does not double-count in the album", async () => {
    const { db, album, l1, p } = await fixture();
    const before = walkAll(db, { albumId: album.id });
    // (P is already direct on the album; also tag P on L1)
    updateLog(db, l1.id, { rating: 5, date: "2024-06-01", notes: null, people: [{ id: p.id }] });
    const after = walkAll(db, { albumId: album.id });
    expect(after.sort()).toEqual(before.sort());
    expect(unique(after)).toBe(true);
  });

  it("person profile: loose photos credited only to directly-added album people", async () => {
    const { db, p, q, ids } = await fixture();
    const pPhotos = walkAll(db, { personId: p.id });
    const qPhotos = walkAll(db, { personId: q.id });

    // P is direct on the album → gets the loose photos p4,p5. P is on no logs → nothing else.
    expect(pPhotos.sort()).toEqual([ids.p4, ids.p5].sort());
    // Q is tagged on L1 → gets p1,p2. Q is not on the album → NOT p4,p5.
    expect(qPhotos.sort()).toEqual([ids.p1, ids.p2].sort());
    expect(qPhotos).not.toContain(ids.p4);
    expect(qPhotos).not.toContain(ids.p5);
  });

  it("person profile dedup: a person both direct on an album and tagged on its event sees each photo once", async () => {
    const { db, l1, p, ids } = await fixture();
    updateLog(db, l1.id, { rating: 5, date: "2024-06-01", notes: null, people: [{ id: p.id }] });

    const pPhotos = walkAll(db, { personId: p.id });
    expect(pPhotos.sort()).toEqual([ids.p1, ids.p2, ids.p4, ids.p5].sort());
    expect(unique(pPhotos)).toBe(true);
  });

  it("person profile still excludes orphaned photos", async () => {
    const { db, l2, p, ids } = await fixture();
    // Delete L2 keeping photos → p3 becomes an orphan (log_id null, album_id null).
    db.$client.prepare("DELETE FROM logs WHERE id = ?").run(l2.id);

    const pPhotos = walkAll(db, { personId: p.id });
    expect(pPhotos).not.toContain(ids.p3);
    // But the main gallery still shows it.
    expect(walkAll(db, {})).toContain(ids.p3);
  });

  it("the main gallery shows every stored photo exactly once", async () => {
    const { db, ids } = await fixture();
    const all = walkAll(db, {});
    expect(all.sort()).toEqual(Object.values(ids).sort());
    expect(unique(all)).toBe(true);
  });

  it("cursor pagination over the album OR-query has no repeats or gaps", async () => {
    const { db, album } = await fixture();
    const full = listGalleryPhotos(db, { albumId: album.id, limit: 100 }).photos.map((p) => p.id);
    const paged = walkAll(db, { albumId: album.id, limit: 2 });
    expect(paged).toEqual(full);
    expect(unique(paged)).toBe(true);
  });

  it("cursor pagination over the extended person-photos query has no repeats or gaps", async () => {
    const { db, l1, p } = await fixture();
    updateLog(db, l1.id, { rating: 5, date: "2024-06-01", notes: null, people: [{ id: p.id }] });

    const full = listGalleryPhotos(db, { personId: p.id, limit: 100 }).photos.map((x) => x.id);
    const paged = walkAll(db, { personId: p.id, limit: 2 });
    expect(paged).toEqual(full);
    expect(unique(paged)).toBe(true);
  });
});
