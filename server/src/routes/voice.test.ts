import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createTestDb } from "../testUtils/testDb.js";
import type { VoiceParser } from "../lib/voiceModel.js";

/**
 * The voice endpoint and who may call it. `config` reads AUTH_ENABLED at module load, so each
 * test re-imports the app after setting the environment (as app.test.ts does).
 */
describe("POST /api/voice", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    ctx?.cleanup();
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_PASSWORD_HASH;
    delete process.env.SESSION_SECRET;
  });

  async function setup({ auth = false, parser = null as VoiceParser | null } = {}) {
    if (auth) {
      process.env.AUTH_ENABLED = "true";
      process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 4);
    }
    ctx = createTestDb();
    const { createApp } = await import("../app.js");
    const { createDeviceToken } = await import("../services/deviceTokensService.js");
    const app = createApp(ctx.db, undefined, undefined, parser);
    return { app, token: createDeviceToken(ctx.db, "Pixel 6").token };
  }

  const say = (app: Parameters<typeof request>[0], text: string, token?: string) => {
    const req = request(app).post("/api/voice").send({ text });
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };

  it("adds what was said and answers with a line for the device to show", async () => {
    const { app, token } = await setup();
    const res = await say(app, "add eggs to the shopping list", token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ action: "add_to_list", added: ["Eggs"], parsedBy: "rules" });
    const lists = (await request(app).get("/api/lists")).body as { name: string; itemCount: number }[];
    expect(lists.find((l) => l.name === "Shopping")?.itemCount).toBe(1);
  });

  it("uses the model it was given", async () => {
    const parser: VoiceParser = vi
      .fn()
      .mockResolvedValue({ action: "add_to_list", input: { listId: null, items: ["Eggs", "Milk"] } });
    const { app, token } = await setup({ parser });
    const res = await say(app, "add eggs and milk", token);

    expect(res.body).toMatchObject({ added: ["Eggs", "Milk"], parsedBy: "model" });
    expect(parser).toHaveBeenCalledWith("add eggs and milk", { lists: expect.any(Array) });
  });

  describe("GET /api/voice/status — the companion app's Test connection", () => {
    it("names the device and says it would use the rules backup without a model", async () => {
      const { app, token } = await setup({ auth: true });
      const res = await request(app).get("/api/voice/status").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ device: "Pixel 6", parser: "rules" });
    });

    it("says it would use the model when there is one", async () => {
      const { app, token } = await setup({ parser: vi.fn() });
      const res = await request(app).get("/api/voice/status").set("Authorization", `Bearer ${token}`);
      expect(res.body).toEqual({ device: "Pixel 6", parser: "model" });
    });

    it("adds nothing to any list", async () => {
      const { app, token } = await setup();
      await request(app).get("/api/voice/status").set("Authorization", `Bearer ${token}`);
      const lists = (await request(app).get("/api/lists")).body as { itemCount: number }[];
      expect(lists.every((l) => l.itemCount === 0)).toBe(true);
    });

    it("refuses a wrong token, so a bad pairing shows up before the first command", async () => {
      const { app } = await setup({ auth: true });
      const res = await request(app).get("/api/voice/status").set("Authorization", "Bearer hub_wrong");
      expect(res.status).toBe(401);
    });
  });

  it("answers 422 when nothing in the command can be added", async () => {
    const { app, token } = await setup();
    const res = await say(app, "add", token);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Didn't catch anything/);
  });

  it("rejects an empty or runaway transcript", async () => {
    const { app, token } = await setup();
    expect((await say(app, "   ", token)).status).toBe(400);
    expect((await say(app, "x".repeat(501), token)).status).toBe(400);
  });

  describe("with auth off (the LAN default)", () => {
    it("accepts a valid token, and no token at all like any other /api call", async () => {
      const { app, token } = await setup();
      expect((await say(app, "add eggs", token)).status).toBe(200);
      expect((await say(app, "add milk")).status).toBe(200);
    });

    it("still refuses a wrong token, so a misconfigured device fails loudly", async () => {
      const { app } = await setup();
      const res = await say(app, "add eggs", "hub_not-a-real-token");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid device token");
    });

    it("refuses a header that isn't a bearer token", async () => {
      const { app, token } = await setup();
      const res = await request(app).post("/api/voice").set("Authorization", `Basic ${token}`).send({ text: "add eggs" });
      expect(res.status).toBe(401);
    });
  });

  describe("with auth on", () => {
    it("accepts a device token with no session", async () => {
      const { app, token } = await setup({ auth: true });
      expect((await say(app, "add eggs", token)).status).toBe(200);
    });

    it("refuses no token and no session", async () => {
      const { app } = await setup({ auth: true });
      expect((await say(app, "add eggs")).status).toBe(401);
    });

    it("accepts a signed-in browser", async () => {
      const { app } = await setup({ auth: true });
      const agent = request.agent(app);
      await agent.post("/api/auth/login").send({ password: "correct-horse" });
      expect((await agent.post("/api/voice").send({ text: "add eggs" })).status).toBe(200);
    });

    it("refuses a revoked token", async () => {
      const { app, token } = await setup({ auth: true });
      const { revokeDeviceToken, listDeviceTokens } = await import("../services/deviceTokensService.js");
      revokeDeviceToken(ctx.db, listDeviceTokens(ctx.db)[0].id);
      expect((await say(app, "add eggs", token)).status).toBe(401);
    });

    it("doesn't let a device token reach anything else", async () => {
      const { app, token } = await setup({ auth: true });
      const res = await request(app).get("/api/lists").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });
});
