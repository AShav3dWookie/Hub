import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { findOrCreateEntity } from "../services/entityService.js";

describe("entities notes routes", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("creates, lists, updates, and deletes a note via the API", async () => {
    ctx = createTestDb();
    const app = createApp(ctx.db);
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");

    const createRes = await request(app)
      .post(`/api/entities/${sarah.id}/notes`)
      .send({ category: "gift_idea", body: "Concert tickets" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.body).toBe("Concert tickets");
    const noteId = createRes.body.id;

    const listRes = await request(app).get(`/api/entities/${sarah.id}/notes`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const updateRes = await request(app)
      .put(`/api/entities/${sarah.id}/notes/${noteId}`)
      .send({ body: "Concert tickets (sold out, try again)" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.body).toBe("Concert tickets (sold out, try again)");

    const deleteRes = await request(app).delete(`/api/entities/${sarah.id}/notes/${noteId}`);
    expect(deleteRes.status).toBe(204);

    const listAfterDelete = await request(app).get(`/api/entities/${sarah.id}/notes`);
    expect(listAfterDelete.body).toHaveLength(0);
  });

  it("rejects an empty note body with 400", async () => {
    ctx = createTestDb();
    const app = createApp(ctx.db);
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");

    const res = await request(app).post(`/api/entities/${sarah.id}/notes`).send({ body: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when updating a nonexistent note", async () => {
    ctx = createTestDb();
    const app = createApp(ctx.db);
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");

    const res = await request(app)
      .put(`/api/entities/${sarah.id}/notes/999999`)
      .send({ body: "x" });
    expect(res.status).toBe(404);
  });
});

describe("entity routes", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }

  it("creates a bare entity and dedupes on a case/whitespace-insensitive title", async () => {
    const app = setup();
    const a = await request(app)
      .post("/api/entities")
      .send({ category: "movie", title: "The Matrix", releaseYear: 1999 });
    expect(a.status).toBe(201);

    const b = await request(app)
      .post("/api/entities")
      .send({ category: "movie", title: "  the matrix " });
    expect(b.body.id).toBe(a.body.id);
  });

  it("400s on an invalid create body", async () => {
    const res = await request(setup()).post("/api/entities").send({ category: "movie", title: "" });
    expect(res.status).toBe(400);
  });

  it("GET /api/entities/:id returns the entity with its logs", async () => {
    const app = setup();
    const created = await request(app)
      .post("/api/logs")
      .send({ category: "eating_out", title: "Chipotle", rating: 4, date: "2024-01-01" });

    const res = await request(app).get(`/api/entities/${created.body.entityId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: "entity", title: "Chipotle", visitCount: 1 });
    expect(res.body.logs).toHaveLength(1);
  });

  it("GET /api/entities/:id returns a person profile for a person entity", async () => {
    const app = setup();
    await request(app)
      .post("/api/logs")
      .send({ category: "movie", title: "Heat", date: "2024-01-01", people: [{ name: "Sam" }] });
    const sarah = findOrCreateEntity(ctx.db, "person", "Sam");

    const res = await request(app).get(`/api/entities/${sarah.id}`);
    expect(res.body).toMatchObject({ type: "person" });
    expect(res.body.appearances).toHaveLength(1);
  });

  it("400s on a non-integer id and 404s on an unknown id", async () => {
    const app = setup();
    expect((await request(app).get("/api/entities/abc")).status).toBe(400);
    expect((await request(app).get("/api/entities/999999")).status).toBe(404);
  });

  it("GET /api/entities/search autocompletes by title within a category", async () => {
    const app = setup();
    await request(app)
      .post("/api/logs")
      .send({ category: "movie", title: "Interstellar", date: "2024-01-01" });

    const res = await request(app).get("/api/entities/search?category=movie&q=inter");
    expect(res.status).toBe(200);
    expect(res.body[0].title).toBe("Interstellar");
  });

  it("GET /api/entities/:id/photos returns a person's linked photos, paginated", async () => {
    const app = setup();
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();

    const log = await request(app)
      .post("/api/logs")
      .send({ category: "movie", title: "Heat", date: "2024-01-01", people: [{ name: "Alice" }] });
    const aliceId = log.body.people[0].id;
    await request(app)
      .post(`/api/logs/${log.body.id}/photos`)
      .attach("photos", png, { filename: "a.png", contentType: "image/png" })
      .attach("photos", png, { filename: "b.png", contentType: "image/png" });

    const p1 = await request(app).get(`/api/entities/${aliceId}/photos?limit=1`);
    expect(p1.status).toBe(200);
    expect(p1.body.photos).toHaveLength(1);
    expect(p1.body.nextCursor).toBeGreaterThan(0);
    expect(p1.body.photos[0].log).toMatchObject({ entityTitle: "Heat" });

    const p2 = await request(app).get(
      `/api/entities/${aliceId}/photos?limit=1&cursor=${p1.body.nextCursor}`,
    );
    expect(p2.body.photos).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("GET /api/entities/:id/photos is empty for a person not tagged in any photo'd log", async () => {
    const app = setup();
    const bob = findOrCreateEntity(ctx.db, "person", "Bob");
    const res = await request(app).get(`/api/entities/${bob.id}/photos`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ photos: [], nextCursor: null });
  });

  it("GET /api/entities/:id/photos 400s for a non-person entity and 404s for an unknown id", async () => {
    const app = setup();
    const movie = await request(app)
      .post("/api/entities")
      .send({ category: "movie", title: "Dune" });
    expect((await request(app).get(`/api/entities/${movie.body.id}/photos`)).status).toBe(400);
    expect((await request(app).get("/api/entities/999999/photos")).status).toBe(404);
  });
});
