import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createTestDb } from "../testUtils/testDb.js";
import type { VoiceParser } from "../lib/voiceModel.js";
import type { ServerLogDTO } from "@logger/shared";

/**
 * Reading the hub's log from a PC, and the token scopes that keep it apart from the phone's
 * jobs. `config` reads AUTH_ENABLED at module load, so each test re-imports the app.
 */
describe("GET /api/device/logs", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    ctx?.cleanup();
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_PASSWORD_HASH;
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
    return {
      app,
      phone: createDeviceToken(ctx.db, "Pixel 6").token,
      logs: createDeviceToken(ctx.db, "Desktop PC", "logs").token,
    };
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("shows a logs token what a voice command did and why", async () => {
    const parser: VoiceParser = vi.fn().mockRejectedValue(new Error("401 invalid x-api-key"));
    const { app, phone, logs } = await setup({ auth: true, parser });
    await request(app).post("/api/voice").set(bearer(phone)).send({ text: "add eggs" }).expect(503);

    const res = await request(app).get("/api/device/logs").set(bearer(logs)).query({ source: "voice" });
    expect(res.status).toBe(200);
    const [entry] = res.body as ServerLogDTO[];
    expect(entry).toMatchObject({
      level: "error",
      source: "voice",
      message: expect.stringContaining('"add eggs" → refused (503)'),
      data: expect.objectContaining({ text: "add eggs", modelError: "401 invalid x-api-key" }),
    });
  });

  it("answers in plain lines for a terminal", async () => {
    const parser: VoiceParser = vi.fn().mockResolvedValue({ action: "add_to_list", input: { listId: null, items: ["Milk"] } });
    const { app, phone, logs } = await setup({ parser });
    await request(app).post("/api/voice").set(bearer(phone)).send({ text: "add milk" });

    const res = await request(app).get("/api/device/logs").set(bearer(logs)).query({ format: "text", since: "1h" });
    expect(res.type).toBe("text/plain");
    expect(res.text).toMatch(/^\S+Z INFO {2}voice {9}"add milk" → add_to_list: Added Milk to Shopping/m);
  });

  it("keeps the phone's token and the logs token to their own jobs", async () => {
    const { app, phone, logs } = await setup({ auth: true });

    expect((await request(app).get("/api/device/logs").set(bearer(phone))).status).toBe(403);
    expect((await request(app).post("/api/voice").set(bearer(logs)).send({ text: "add eggs" })).status).toBe(403);
    expect((await request(app).get("/api/device/lists").set(bearer(logs))).status).toBe(403);
    expect((await request(app).get("/api/device/lists").set(bearer(phone))).status).toBe(200);
    // Nor can it reach anything a session would.
    expect((await request(app).get("/api/device-tokens").set(bearer(logs))).status).toBe(401);
  });

  it("needs a token or a session once auth is on", async () => {
    const { app } = await setup({ auth: true });
    expect((await request(app).get("/api/device/logs")).status).toBe(401);
    expect((await request(app).get("/api/device/logs").set(bearer("hub_not-a-real-token"))).status).toBe(401);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "correct-horse" }).expect(200);
    expect((await agent.get("/api/device/logs")).status).toBe(200);
  });

  it("logs a refused token, once, without the token", async () => {
    const { app, logs } = await setup();
    for (let i = 0; i < 3; i++) {
      await request(app).post("/api/voice").set(bearer("hub_revoked")).send({ text: "add eggs" }).expect(401);
    }
    const http = (await request(app).get("/api/device/logs").set(bearer(logs)).query({ source: "http" }))
      .body as ServerLogDTO[];
    expect(http.map((e) => e.message)).toEqual(["An unknown or revoked device token was refused at /api/voice"]);
    expect(JSON.stringify(http)).not.toContain("hub_revoked");
  });

  it("is a 400 for a filter it doesn't understand", async () => {
    const { app, logs } = await setup();
    expect((await request(app).get("/api/device/logs").set(bearer(logs)).query({ since: "last week" })).status).toBe(400);
    expect((await request(app).get("/api/device/logs").set(bearer(logs)).query({ level: "debug" })).status).toBe(400);
  });

  it("mints a logs token from Settings and lists it as one", async () => {
    const { app } = await setup();
    const created = await request(app).post("/api/device-tokens").send({ name: "Laptop", scope: "logs" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Laptop", scope: "logs" });
    const listed = (await request(app).get("/api/device-tokens")).body as { name: string; scope: string }[];
    expect(listed.map((d) => [d.name, d.scope])).toEqual([
      ["Pixel 6", "device"],
      ["Desktop PC", "logs"],
      ["Laptop", "logs"],
    ]);
    expect((await request(app).post("/api/device-tokens").send({ name: "X", scope: "admin" })).status).toBe(400);
  });
});
