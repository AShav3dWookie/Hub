import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { findOrCreateEntity } from "../services/entityService.js";

describe("log routes", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }

  it("creates a log against a new entity and auto-creates tagged people", async () => {
    const app = setup();
    const res = await request(app).post("/api/logs").send({
      category: "movie",
      title: "The Matrix",
      rating: 5,
      date: "2024-01-01",
      notes: "great",
      people: [{ name: "Sarah" }],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rating: 5, date: "2024-01-01", notes: "great", photos: [] });
    expect(res.body.people).toEqual([{ id: expect.any(Number), name: "Sarah" }]);
  });

  it("creates a log against an existing entity by id", async () => {
    const app = setup();
    const entity = findOrCreateEntity(ctx.db, "eating_out", "Chipotle");
    const res = await request(app)
      .post("/api/logs")
      .send({ entityId: entity.id, rating: 4, date: "2024-02-01" });
    expect(res.status).toBe(201);
    expect(res.body.entityId).toBe(entity.id);
  });

  it("rejects an invalid body with a 400 and a validation-error shape", async () => {
    const app = setup();
    const res = await request(app).post("/api/logs").send({ date: "2024-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toBeDefined();
  });

  it("rejects an out-of-range rating with 400", async () => {
    const app = setup();
    const res = await request(app)
      .post("/api/logs")
      .send({ category: "movie", title: "X", date: "2024-01-01", rating: 9 });
    expect(res.status).toBe(400);
  });

  it("gets, updates, and deletes a log through the API", async () => {
    const app = setup();
    const created = await request(app)
      .post("/api/logs")
      .send({ category: "book", title: "Dune", rating: 3, date: "2024-01-01" });
    const id = created.body.id;

    const got = await request(app).get(`/api/logs/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.rating).toBe(3);

    const updated = await request(app)
      .put(`/api/logs/${id}`)
      .send({ rating: 5, date: "2024-03-01", notes: "reread" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ rating: 5, notes: "reread" });

    const deleted = await request(app).delete(`/api/logs/${id}`);
    expect(deleted.status).toBe(204);
    expect((await request(app).get(`/api/logs/${id}`)).status).toBe(404);
  });

  it("400s on a non-integer id and 404s on an unknown id", async () => {
    const app = setup();
    expect((await request(app).get("/api/logs/abc")).status).toBe(400);
    expect((await request(app).get("/api/logs/999999")).status).toBe(404);
    expect((await request(app).put("/api/logs/999999").send({ date: "2024-01-01" })).status).toBe(
      404,
    );
  });
});
