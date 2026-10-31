import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";

describe("lists routes", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }

  it("lists the main shopping list on a fresh install", async () => {
    const app = setup();
    const res = await request(app).get("/api/lists");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ name: "Shopping", isDefault: true, itemCount: 0 }),
    ]);
  });

  it("creates a list, adds items, and shows them in order", async () => {
    const app = setup();
    const created = await request(app).post("/api/lists").send({ name: "  Tesco  " });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Tesco", isDefault: false, items: [] });

    const id = created.body.id;
    await request(app).post(`/api/lists/${id}/items`).send({ text: "Eggs" }).expect(201);
    await request(app).post(`/api/lists/${id}/items`).send({ text: "Milk" }).expect(201);

    const list = await request(app).get(`/api/lists/${id}`);
    expect(list.body.items.map((i: { text: string }) => i.text)).toEqual(["Eggs", "Milk"]);
    expect(list.body.itemCount).toBe(2);
  });

  it("rejects a duplicate list name with a 400", async () => {
    const app = setup();
    const res = await request(app).post("/api/lists").send({ name: "shopping" });
    expect(res.status).toBe(400);
  });

  it("rejects blank or over-long text", async () => {
    const app = setup();
    await request(app).post("/api/lists").send({ name: "   " }).expect(400);
    await request(app).post("/api/lists").send({ name: "x".repeat(81) }).expect(400);
    const [main] = (await request(app).get("/api/lists")).body;
    await request(app).post(`/api/lists/${main.id}/items`).send({ text: "" }).expect(400);
    await request(app)
      .post(`/api/lists/${main.id}/items`)
      .send({ text: "x".repeat(201) })
      .expect(400);
  });

  it("renames and makes a list main", async () => {
    const app = setup();
    const { body: tesco } = await request(app).post("/api/lists").send({ name: "Tesco" });

    const res = await request(app)
      .patch(`/api/lists/${tesco.id}`)
      .send({ name: "Tesco Bangor", isDefault: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Tesco Bangor", isDefault: true });

    const all = (await request(app).get("/api/lists")).body;
    expect(all.map((l: { name: string; isDefault: boolean }) => [l.name, l.isDefault])).toEqual([
      ["Tesco Bangor", true],
      ["Shopping", false],
    ]);
  });

  it("rejects an update with nothing in it", async () => {
    const app = setup();
    const [main] = (await request(app).get("/api/lists")).body;
    await request(app).patch(`/api/lists/${main.id}`).send({}).expect(400);
  });

  it("deletes a list, but not the main one", async () => {
    const app = setup();
    const [main] = (await request(app).get("/api/lists")).body;
    const { body: tesco } = await request(app).post("/api/lists").send({ name: "Tesco" });

    await request(app).delete(`/api/lists/${main.id}`).expect(400);
    await request(app).delete(`/api/lists/${tesco.id}`).expect(204);
    await request(app).get(`/api/lists/${tesco.id}`).expect(404);
  });

  it("removes an item", async () => {
    const app = setup();
    const [main] = (await request(app).get("/api/lists")).body;
    const { body: eggs } = await request(app)
      .post(`/api/lists/${main.id}/items`)
      .send({ text: "Eggs" });

    await request(app).delete(`/api/lists/${main.id}/items/${eggs.id}`).expect(204);
    await request(app).delete(`/api/lists/${main.id}/items/${eggs.id}`).expect(404);
    expect((await request(app).get(`/api/lists/${main.id}`)).body.items).toEqual([]);
  });

  it("400s on a non-numeric id", async () => {
    const app = setup();
    await request(app).get("/api/lists/abc").expect(400);
  });
});
