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
    create: { width: 24, height: 24, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
});

describe("log photos routes", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let photosDir: string;

  afterEach(() => {
    ctx?.cleanup();
    if (photosDir) fs.rmSync(photosDir, { recursive: true, force: true });
  });

  function setup() {
    ctx = createTestDb();
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), "logphotos-route-"));
    return createApp(ctx.db, photosDir);
  }

  function movieLogId() {
    return createLog(ctx.db, {
      category: "movie",
      title: "Sicario",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Kate" }],
    }).id;
  }

  it("uploads, serves, and deletes photos", async () => {
    const app = setup();
    const logId = movieLogId();

    const uploadRes = await request(app)
      .post(`/api/logs/${logId}/photos`)
      .attach("photos", png, { filename: "a.png", contentType: "image/png" })
      .attach("photos", png, { filename: "b.png", contentType: "image/png" });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body).toHaveLength(2);
    const [photo] = uploadRes.body;
    expect(photo.url).toMatch(/^\/api\/photos\//);

    const fileRes = await request(app).get(photo.url);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers["content-type"]).toContain("image");

    const thumbRes = await request(app).get(photo.thumbnailUrl);
    expect(thumbRes.status).toBe(200);

    const delRes = await request(app).delete(`/api/logs/${logId}/photos/${photo.id}`);
    expect(delRes.status).toBe(204);

    const afterDel = await request(app).get(`/api/logs/${logId}`);
    expect(afterDel.body.photos).toHaveLength(1);
  });

  it("rejects photos for a non-people category with 400", async () => {
    const app = setup();
    const logId = createLog(ctx.db, {
      category: "book",
      title: "Blood Meridian",
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [],
    }).id;

    const res = await request(app)
      .post(`/api/logs/${logId}/photos`)
      .attach("photos", png, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image upload with 400", async () => {
    const app = setup();
    const logId = movieLogId();

    const res = await request(app)
      .post(`/api/logs/${logId}/photos`)
      .attach("photos", Buffer.from("not an image"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
  });

  it("rejects more than 10 files in one request with 400", async () => {
    const app = setup();
    const logId = movieLogId();

    let req = request(app).post(`/api/logs/${logId}/photos`);
    for (let i = 0; i < 11; i++) {
      req = req.attach("photos", png, { filename: `p${i}.png`, contentType: "image/png" });
    }
    const res = await req;
    expect(res.status).toBe(400);
  });

  it("404s for an unknown log", async () => {
    const app = setup();
    const res = await request(app)
      .post(`/api/logs/999999/photos`)
      .attach("photos", png, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(404);
  });
});
