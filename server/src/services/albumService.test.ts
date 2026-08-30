import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog, getLogById } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { deletePhotosForAlbum, type UploadedPhoto } from "./logPhotosService.js";
import { createAlbumPhotos } from "./albumPhotosService.js";
import {
  createAlbum,
  getAlbumById,
  updateAlbum,
  deleteAlbum,
  listAlbums,
  addAlbumEvent,
  removeAlbumEvent,
  addAlbumPerson,
  removeAlbumPerson,
} from "./albumService.js";
import { LOGGABLE_CATEGORIES } from "@logger/shared";

async function file(name = "photo.png"): Promise<UploadedPhoto> {
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .png()
    .toBuffer();
  return { buffer, originalname: name, mimetype: "image/png", size: buffer.length };
}

describe("albumService", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "album-"));
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

  it("creates an album with people and linked events, and reads it back", () => {
    setup();
    const l1 = movieLog("Heat", [{ name: "Sam" }]);
    const album = createAlbum(ctx.db, {
      title: "  Movie Night  ",
      notes: "fun",
      dateStart: "2024-05-01",
      dateEnd: "2024-05-03",
      people: [{ name: "Alex" }],
      eventLogIds: [l1.id],
    });

    expect(album.title).toBe("Movie Night");
    expect(album.eventCount).toBe(1);
    expect(album.events).toHaveLength(1);
    expect(album.events[0].id).toBe(l1.id);
    expect(album.events[0].photos).toEqual([]);
    expect(album.events[0].albums).toEqual([]);
    // People = directly-added (Alex) ∪ from linked events (Sam), deduped, name-sorted.
    expect(album.people.map((p) => p.name)).toEqual(["Alex", "Sam"]);
    expect(album.directPersonIds).toHaveLength(1);
    const alex = album.people.find((p) => p.name === "Alex")!;
    expect(album.directPersonIds).toEqual([alex.id]);
  });

  it("rejects an end date before the start date", () => {
    setup();
    expect(() =>
      createAlbum(ctx.db, { title: "X", dateStart: "2024-05-05", dateEnd: "2024-05-01" }),
    ).toThrow(/end date/i);
  });

  it("rejects linking a non-existent log", () => {
    setup();
    expect(() => createAlbum(ctx.db, { title: "X", eventLogIds: [999] })).toThrow(/not found/i);
  });

  it("links a log of every loggable category", () => {
    setup();
    const album = createAlbum(ctx.db, { title: "Everything" });
    for (const category of LOGGABLE_CATEGORIES) {
      const log = createLog(ctx.db, {
        category,
        title: `${category} thing`,
        rating: null,
        date: "2024-01-01",
        notes: null,
        people: [],
      });
      const updated = addAlbumEvent(ctx.db, album.id, log.id);
      expect(updated.events.some((e) => e.id === log.id)).toBe(true);
    }
    expect(getAlbumById(ctx.db, album.id).eventCount).toBe(LOGGABLE_CATEGORIES.length);
  });

  it("addAlbumEvent is idempotent (unique pair)", () => {
    setup();
    const l1 = movieLog("Heat");
    const album = createAlbum(ctx.db, { title: "A" });
    addAlbumEvent(ctx.db, album.id, l1.id);
    addAlbumEvent(ctx.db, album.id, l1.id);
    expect(getAlbumById(ctx.db, album.id).eventCount).toBe(1);
  });

  it("adds a person by name (auto-creates) and by id, and removes only direct people", () => {
    setup();
    const l1 = movieLog("Heat", [{ name: "EventOnly" }]);
    const album = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id] });

    const existing = findOrCreateEntity(ctx.db, "person", "Existing Pal");
    addAlbumPerson(ctx.db, album.id, { name: "New Pal" });
    const people = addAlbumPerson(ctx.db, album.id, { id: existing.id });
    expect([...people.map((p) => p.name)].sort()).toEqual(["EventOnly", "Existing Pal", "New Pal"]);

    const dto = getAlbumById(ctx.db, album.id);
    const eventOnly = dto.people.find((p) => p.name === "EventOnly")!;
    expect(dto.directPersonIds).not.toContain(eventOnly.id);

    // Removing a person who is only there via an event is a no-op (they stay, via the event).
    removeAlbumPerson(ctx.db, album.id, eventOnly.id);
    expect(getAlbumById(ctx.db, album.id).people.some((p) => p.name === "EventOnly")).toBe(true);

    // Removing a directly-added person drops them.
    const newPal = dto.people.find((p) => p.name === "New Pal")!;
    removeAlbumPerson(ctx.db, album.id, newPal.id);
    expect(getAlbumById(ctx.db, album.id).people.some((p) => p.name === "New Pal")).toBe(false);
  });

  it("rejects a non-person id for addAlbumPerson", () => {
    setup();
    const l1 = movieLog("Heat");
    const album = createAlbum(ctx.db, { title: "A" });
    expect(() => addAlbumPerson(ctx.db, album.id, { id: l1.entityId })).toThrow(/not a person/i);
  });

  it("does not modify the linked events (one-way linkage)", () => {
    setup();
    const l1 = movieLog("Heat", [{ name: "Sam" }]);
    const before = getLogById(ctx.db, l1.id);
    const album = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id], people: [{ name: "Alex" }] });
    addAlbumPerson(ctx.db, album.id, { name: "Bru" });

    const after = getLogById(ctx.db, l1.id);
    expect(after.people).toEqual(before.people); // Sam only, no Alex/Bru
    expect(after.rating).toBe(before.rating);
    expect(after.date).toBe(before.date);
  });

  it("surfaces album membership on the event via getLogById / entity detail", () => {
    setup();
    const l1 = movieLog("Heat");
    const album = createAlbum(ctx.db, { title: "Trip", eventLogIds: [l1.id] });
    expect(getLogById(ctx.db, l1.id).albums).toEqual([{ id: album.id, title: "Trip" }]);

    removeAlbumEvent(ctx.db, album.id, l1.id);
    expect(getLogById(ctx.db, l1.id).albums).toEqual([]);
  });

  it("updates title / notes / dates and bumps updatedAt", async () => {
    setup();
    const album = createAlbum(ctx.db, { title: "Old" });
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateAlbum(ctx.db, album.id, {
      title: "New",
      notes: "n",
      dateStart: "2024-01-01",
      dateEnd: null,
    });
    expect(updated.title).toBe("New");
    expect(updated.notes).toBe("n");
    expect(updated.updatedAt >= album.updatedAt).toBe(true);
  });

  it("lists albums newest-first", () => {
    setup();
    const a = createAlbum(ctx.db, { title: "First" });
    const b = createAlbum(ctx.db, { title: "Second" });
    expect(listAlbums(ctx.db).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it("delete: default orphans loose photos; ?deletePhotos removes them", async () => {
    setup();
    const a1 = createAlbum(ctx.db, { title: "Keep" });
    await createAlbumPhotos(ctx.db, photosDir, a1.id, [await file("loose1.png")]);
    const filesBefore = fs.readdirSync(photosDir);
    deleteAlbum(ctx.db, a1.id);
    // Row still exists as an orphan; files untouched.
    expect(fs.readdirSync(photosDir).sort()).toEqual(filesBefore.sort());

    const a2 = createAlbum(ctx.db, { title: "Nuke" });
    await createAlbumPhotos(ctx.db, photosDir, a2.id, [await file("loose2.png")]);
    deletePhotosForAlbum(ctx.db, photosDir, a2.id);
    deleteAlbum(ctx.db, a2.id);
    expect(fs.readdirSync(photosDir).some((f) => f.includes("loose2"))).toBe(false);
  });

  it("deleting a linked log removes it from the album", () => {
    setup();
    const l1 = movieLog("Heat");
    const l2 = movieLog("Sicario");
    const album = createAlbum(ctx.db, { title: "A", eventLogIds: [l1.id, l2.id] });
    expect(getAlbumById(ctx.db, album.id).eventCount).toBe(2);

    ctx.db.$client.prepare("DELETE FROM logs WHERE id = ?").run(l1.id);
    expect(getAlbumById(ctx.db, album.id).eventCount).toBe(1);
  });

  it("404s for a missing album", () => {
    setup();
    expect(() => getAlbumById(ctx.db, 123)).toThrow(/not found/i);
  });
});
