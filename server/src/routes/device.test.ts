import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createTestDb } from "../testUtils/testDb.js";

/**
 * The companion app's list cache and shop tagging. Auth is on throughout: that is where the
 * difference between a device token and a signed-in browser matters.
 */
describe("/api/device", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    ctx?.cleanup();
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_PASSWORD_HASH;
  });

  async function setup() {
    process.env.AUTH_ENABLED = "true";
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 4);
    ctx = createTestDb();
    const { createApp } = await import("../app.js");
    const { createDeviceToken } = await import("../services/deviceTokensService.js");
    const lists = await import("../services/listService.js");
    const tesco = lists.createList(ctx.db, { name: "Tesco Bangor" });
    lists.addListItem(ctx.db, tesco.id, { text: "Eggs" });
    lists.addListItem(ctx.db, tesco.id, { text: "Milk" });
    const app = createApp(ctx.db, undefined, undefined, null);
    return { app, tesco, token: createDeviceToken(ctx.db, "Pixel 6").token };
  }

  const shop = { latitude: 53.2274, longitude: -4.1293, radiusM: 75 };

  it("gives a device every shopping list with its location and items, in one request", async () => {
    const { app, token } = await setup();
    const res = await request(app).get("/api/device/lists").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((l: { name: string }) => l.name)).toEqual(["Shopping", "Tesco Bangor"]);
    const tesco = res.body[1];
    expect(tesco.location).toBeNull();
    expect(tesco.items.map((i: { text: string }) => i.text)).toEqual(["Eggs", "Milk"]);
  });

  it("tags where a shop is, and the lists show it", async () => {
    const { app, tesco, token } = await setup();
    const put = await request(app)
      .put(`/api/device/lists/${tesco.id}/location`)
      .set("Authorization", `Bearer ${token}`)
      .send({ location: shop });
    expect(put.status).toBe(200);
    expect(put.body.location).toEqual(shop);

    const lists = await request(app).get("/api/device/lists").set("Authorization", `Bearer ${token}`);
    expect(lists.body.find((l: { id: number }) => l.id === tesco.id).location).toEqual(shop);
  });

  it("clears a tag", async () => {
    const { app, tesco, token } = await setup();
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).put(`/api/device/lists/${tesco.id}/location`).set(auth).send({ location: shop });
    const res = await request(app).put(`/api/device/lists/${tesco.id}/location`).set(auth).send({ location: null });
    expect(res.body.location).toBeNull();
  });

  it.each([
    ["a latitude off the planet", { ...shop, latitude: 91 }],
    ["a radius too small to work", { ...shop, radiusM: 10 }],
    ["a radius bigger than a town", { ...shop, radiusM: 5000 }],
    ["a missing coordinate", { latitude: 53.2, radiusM: 75 }],
  ])("refuses %s", async (_case, location) => {
    const { app, tesco, token } = await setup();
    const res = await request(app)
      .put(`/api/device/lists/${tesco.id}/location`)
      .set("Authorization", `Bearer ${token}`)
      .send({ location });
    expect(res.status).toBe(400);
  });

  it("404s a list that doesn't exist", async () => {
    const { app, token } = await setup();
    const res = await request(app)
      .put("/api/device/lists/999/location")
      .set("Authorization", `Bearer ${token}`)
      .send({ location: shop });
    expect(res.status).toBe(404);
  });

  it("refuses no token, and a wrong one", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/device/lists")).status).toBe(401);
    expect((await request(app).get("/api/device/lists").set("Authorization", "Bearer hub_wrong")).status).toBe(401);
  });

  it("lets a signed-in browser use it too", async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "correct-horse" });
    expect((await agent.get("/api/device/lists")).status).toBe(200);
  });

  it("still gives a device token nothing beyond voice and these", async () => {
    const { app, tesco, token } = await setup();
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).get("/api/lists").set(auth)).status).toBe(401);
    expect((await request(app).delete(`/api/lists/${tesco.id}`).set(auth)).status).toBe(401);
    expect((await request(app).get("/api/device-tokens").set(auth)).status).toBe(401);
  });
});
