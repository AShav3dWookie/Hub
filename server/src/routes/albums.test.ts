import { describe, it, expect, afterEach, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { createLog } from "../services/logService.js";
import { MAX_PHOTOS_PER_ALBUM } from "../services/logPhotosService.js";

let png: Buffer;

beforeAll(async () => {
  png = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();
});

describe("albums routes", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "albums-route-"));
    return createApp(ctx.db, photosDir);
  }

  function movieLogId(title = "Heat") {
    return createLog(ctx.db, {
      category: "movie",
      title,
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Kate" }],
    }).id;
  }

  it("runs the full album lifecycle", async () => {
    const app = setup();
    const l1 = movieLogId("Heat");
    const l2 = movieLogId("Sicario");

    const created = await request(app)
      .post("/api/albums")
      .send({ title: "Trip", notes: "n", eventLogIds: [l1], people: [{ name: "Alex" }] });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body.eventCount).toBe(1);
    expect(created.body.people.map((p: { name: string }) => p.name).sort()).toEqual(["Alex", "Kate"]);

    // add second event
    const addEvent = await request(app).post(`/api/albums/${id}/events`).send({ logId: l2 });
    expect(addEvent.status).toBe(201);
    expect(addEvent.body.eventCount).toBe(2);

    // update
    const updated = await request(app)
      .put(`/api/albums/${id}`)
      .send({ title: "Trip 2024", notes: null, dateStart: "2024-01-01", dateEnd: "2024-01-05" });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Trip 2024");

    // the linked event now reports album membership
    const logDetail = await request(app).get(`/api/logs/${l1}`);
    expect(logDetail.body.albums).toEqual([{ id, title: "Trip 2024" }]);

    // remove an event
    const rmEvent = await request(app).delete(`/api/albums/${id}/events/${l2}`);
    expect(rmEvent.status).toBe(204);
    expect((await request(app).get(`/api/albums/${id}`)).body.eventCount).toBe(1);

    // people
    const addPerson = await request(app).post(`/api/albums/${id}/people`).send({ name: "Bru" });
    expect(addPerson.status).toBe(200);
    const alexId = created.body.directPersonIds[0];
    expect((await request(app).delete(`/api/albums/${id}/people/${alexId}`)).status).toBe(204);

    // delete
    expect((await request(app).delete(`/api/albums/${id}`)).status).toBe(204);
    expect((await request(app).get(`/api/albums/${id}`)).status).toBe(404);
  });

  it("aggregates linked-event + loose photos and never returns a duplicate id", async () => {
    const app = setup();
    const l1 = movieLogId("Heat");
    await request(app)
      .post(`/api/logs/${l1}/photos`)
      .attach("photos", png, { filename: "e1.png", contentType: "image/png" })
      .attach("photos", png, { filename: "e2.png", contentType: "image/png" });

    const album = (await request(app).post("/api/albums").send({ title: "A", eventLogIds: [l1] })).body;

    const upload = await request(app)
      .post(`/api/albums/${album.id}/photos`)
      .attach("photos", png, { filename: "loose1.png", contentType: "image/png" });
    expect(upload.status).toBe(201);

    const page = await request(app).get(`/api/albums/${album.id}/photos`);
    expect(page.status).toBe(200);
    const ids = page.body.photos.map((p: { id: number }) => p.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("guards album photo deletion to loose photos of that album", async () => {
    const app = setup();
    const l1 = movieLogId("Heat");
    const eventPhoto = (
      await request(app)
        .post(`/api/logs/${l1}/photos`)
        .attach("photos", png, { filename: "e.png", contentType: "image/png" })
    ).body[0];

    const albumA = (await request(app).post("/api/albums").send({ title: "A", eventLogIds: [l1] })).body;
    const albumB = (await request(app).post("/api/albums").send({ title: "B" })).body;
    const loose = (
      await request(app)
        .post(`/api/albums/${albumA.id}/photos`)
        .attach("photos", png, { filename: "l.png", contentType: "image/png" })
    ).body[0];

    const filesBefore = fs.readdirSync(photosDir).sort();

    // Cannot delete an aggregated event photo through the album route.
    expect((await request(app).delete(`/api/albums/${albumA.id}/photos/${eventPhoto.id}`)).status).toBe(404);
    // Cannot delete album A's loose photo through album B.
    expect((await request(app).delete(`/api/albums/${albumB.id}/photos/${loose.id}`)).status).toBe(404);
    // Nothing was removed by the rejected calls.
    expect(fs.readdirSync(photosDir).sort()).toEqual(filesBefore);
    expect((await request(app).get(eventPhoto.url)).status).toBe(200);

    // Can delete its own loose photo — row + files gone, still serving the event photo.
    expect((await request(app).delete(`/api/albums/${albumA.id}/photos/${loose.id}`)).status).toBe(204);
    expect((await request(app).get(loose.url)).status).toBe(404);
    expect((await request(app).get(loose.thumbnailUrl)).status).toBe(404);
    expect((await request(app).get(eventPhoto.url)).status).toBe(200);
    const remaining = (await request(app).get(`/api/albums/${albumA.id}/photos`)).body.photos;
    expect(remaining.map((p: { id: number }) => p.id)).toEqual([eventPhoto.id]);
    const gallery = (await request(app).get("/api/gallery")).body.photos;
    expect(gallery.map((p: { id: number }) => p.id)).not.toContain(loose.id);
  });

  it("?deletePhotos on album delete removes only loose photos; linked events keep theirs", async () => {
    const app = setup();
    const l1 = movieLogId("Heat");
    const evPhotos = (
      await request(app)
        .post(`/api/logs/${l1}/photos`)
        .attach("photos", png, { filename: "e1.png", contentType: "image/png" })
        .attach("photos", png, { filename: "e2.png", contentType: "image/png" })
    ).body;
    const album = (await request(app).post("/api/albums").send({ title: "A", eventLogIds: [l1] })).body;
    const loose = (
      await request(app)
        .post(`/api/albums/${album.id}/photos`)
        .attach("photos", png, { filename: "l.png", contentType: "image/png" })
    ).body[0];

    expect((await request(app).delete(`/api/albums/${album.id}?deletePhotos=true`)).status).toBe(204);

    // loose photo file + serving gone
    expect((await request(app).get(loose.url)).status).toBe(404);
    // the linked event's photos are untouched and still on the log
    const logAfter = (await request(app).get(`/api/logs/${l1}`)).body;
    expect(logAfter.photos.map((p: { id: number }) => p.id).sort()).toEqual(
      evPhotos.map((p: { id: number }) => p.id).sort(),
    );
    expect((await request(app).get(evPhotos[0].url)).status).toBe(200);
  });

  it("default album delete keeps loose photos as gallery orphans", async () => {
    const app = setup();
    const album = (await request(app).post("/api/albums").send({ title: "A" })).body;
    const loose = (
      await request(app)
        .post(`/api/albums/${album.id}/photos`)
        .attach("photos", png, { filename: "l.png", contentType: "image/png" })
    ).body[0];

    expect((await request(app).delete(`/api/albums/${album.id}`)).status).toBe(204);

    expect((await request(app).get(loose.url)).status).toBe(200); // file still served
    const gallery = (await request(app).get("/api/gallery")).body.photos;
    const orphan = gallery.find((p: { id: number }) => p.id === loose.id);
    expect(orphan).toBeTruthy();
    expect(orphan.log).toBeNull();
  });

  it("rejects an oversized loose upload batch without writing files", async () => {
    const app = setup();
    const album = (await request(app).post("/api/albums").send({ title: "A" })).body;
    let req = request(app).post(`/api/albums/${album.id}/photos`);
    for (let i = 0; i < MAX_PHOTOS_PER_ALBUM + 5; i++) {
      req = req.attach("photos", png, { filename: `p${i}.png`, contentType: "image/png" });
    }
    expect((await req).status).toBe(400);
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
  });

  it("validates input", async () => {
    const app = setup();
    expect((await request(app).post("/api/albums").send({})).status).toBe(400);
    expect(
      (await request(app).post("/api/albums").send({ title: "x", dateStart: "2024-02-02", dateEnd: "2024-01-01" }))
        .status,
    ).toBe(400);
    expect((await request(app).post("/api/albums").send({ title: "x", eventLogIds: [999] })).status).toBe(400);
    expect((await request(app).get("/api/albums/999")).status).toBe(404);
  });

  it("rejects a non-image loose upload with 400", async () => {
    const app = setup();
    const album = (await request(app).post("/api/albums").send({ title: "A" })).body;
    const res = await request(app)
      .post(`/api/albums/${album.id}/photos`)
      .attach("photos", Buffer.from("nope"), { filename: "x.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });
});
