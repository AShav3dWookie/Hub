import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createTestDb } from "../testUtils/testDb.js";

describe("device tokens routes", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    ctx?.cleanup();
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_PASSWORD_HASH;
  });

  async function setup(auth = false) {
    if (auth) {
      process.env.AUTH_ENABLED = "true";
      process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 4);
    }
    ctx = createTestDb();
    const { createApp } = await import("../app.js");
    return createApp(ctx.db);
  }

  it("creates a device, shows its token once, lists it without the token, and revokes it", async () => {
    const app = await setup();
    const created = await request(app).post("/api/device-tokens").send({ name: "Pixel 6" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Pixel 6", lastUsedAt: null });
    expect(created.body.token).toMatch(/^hub_/);

    const listed = await request(app).get("/api/device-tokens");
    expect(listed.body).toEqual([expect.objectContaining({ id: created.body.id, name: "Pixel 6" })]);
    expect(listed.body[0]).not.toHaveProperty("token");

    await request(app).delete(`/api/device-tokens/${created.body.id}`).expect(204);
    await request(app).delete(`/api/device-tokens/${created.body.id}`).expect(404);
    expect((await request(app).get("/api/device-tokens")).body).toEqual([]);
  });

  it("needs a name", async () => {
    const app = await setup();
    await request(app).post("/api/device-tokens").send({ name: "  " }).expect(400);
    await request(app).post("/api/device-tokens").send({ name: "x".repeat(61) }).expect(400);
  });

  it("with auth on, can't be managed with a device token — only a signed-in browser", async () => {
    const app = await setup(true);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "correct-horse" });
    const { body } = await agent.post("/api/device-tokens").send({ name: "Pixel 6" });

    const asDevice = (req: request.Test) => req.set("Authorization", `Bearer ${body.token}`);
    expect((await asDevice(request(app).get("/api/device-tokens"))).status).toBe(401);
    expect((await asDevice(request(app).post("/api/device-tokens").send({ name: "Evil" }))).status).toBe(401);
    expect((await asDevice(request(app).delete(`/api/device-tokens/${body.id}`))).status).toBe(401);
    expect((await agent.get("/api/device-tokens")).body).toHaveLength(1);
  });
});
