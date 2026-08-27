import { describe, it, expect, afterEach, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { createLog } from "../services/logService.js";

let png: Buffer;

beforeAll(async () => {
  png = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .png()
    .toBuffer();
});

describe("gallery routes", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-route-"));
    return createApp(ctx.db, photosDir);
  }

  function movieLogId() {
    return createLog(ctx.db, {
      category: "movie",
      title: "Heat",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Kate" }],
    }).id;
  }

  async function upload(app: ReturnType<typeof createApp>, logId: number, n: number) {
    let req = request(app).post(`/api/logs/${logId}/photos`);
    for (let i = 0; i < n; i++) {
      req = req.attach("photos", png, { filename: `p${i}.png`, contentType: "image/png" });
    }
    return req;
  }

  it("lists all photos with nextCursor pagination", async () => {
    const app = setup();
    const logId = movieLogId();
    await upload(app, logId, 5);

    const p1 = await request(app).get("/api/gallery?limit=2");
    expect(p1.status).toBe(200);
    expect(p1.body.photos).toHaveLength(2);
    expect(p1.body.nextCursor).toBeGreaterThan(0);

    const p2 = await request(app).get(`/api/gallery?limit=2&cursor=${p1.body.nextCursor}`);
    const p3 = await request(app).get(`/api/gallery?limit=2&cursor=${p2.body.nextCursor}`);
    expect(p3.body.photos).toHaveLength(1);
    expect(p3.body.nextCursor).toBeNull();

    const seen = [...p1.body.photos, ...p2.body.photos, ...p3.body.photos].map((x) => x.id);
    expect(new Set(seen).size).toBe(5);
  });

  it("deletes a photo via the gallery and it disappears from the list", async () => {
    const app = setup();
    const logId = movieLogId();
    const up = await upload(app, logId, 1);
    const photoId = up.body[0].id;

    const del = await request(app).delete(`/api/gallery/${photoId}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/api/gallery");
    expect(list.body.photos).toHaveLength(0);

    const delAgain = await request(app).delete(`/api/gallery/${photoId}`);
    expect(delAgain.status).toBe(404);
  });

  it("still serves the image file after its log is deleted (keep photos)", async () => {
    const app = setup();
    const logId = movieLogId();
    const up = await upload(app, logId, 1);
    const photo = up.body[0];

    const del = await request(app).delete(`/api/logs/${logId}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/api/gallery");
    expect(list.body.photos).toHaveLength(1);
    expect(list.body.photos[0].log).toBeNull();

    const fileRes = await request(app).get(photo.url);
    expect(fileRes.status).toBe(200);
  });

  it("removes photos when a log is deleted with ?deletePhotos=true", async () => {
    const app = setup();
    const logId = movieLogId();
    await upload(app, logId, 2);
    expect(fs.readdirSync(photosDir).length).toBeGreaterThan(0);

    const del = await request(app).delete(`/api/logs/${logId}?deletePhotos=true`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/api/gallery");
    expect(list.body.photos).toHaveLength(0);
    expect(fs.readdirSync(photosDir)).toHaveLength(0);
  });
});
