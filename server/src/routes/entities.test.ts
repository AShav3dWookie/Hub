import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
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
