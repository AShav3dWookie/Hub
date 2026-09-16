import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createTestDb } from "../testUtils/testDb.js";
import { pushSubscriptions } from "../db/schema.js";
import { listSubscriptions, upsertSubscription } from "../services/pushSubscriptionsService.js";
import type { PushSendResult } from "../lib/webPush.js";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";
const subscription = { endpoint: ENDPOINT, keys: { p256dh: "p256dh-key", auth: "auth-secret" } };

describe("notifications routes", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_PASSWORD_HASH;
  });

  async function appWith(result: PushSendResult = "ok") {
    ctx = createTestDb();
    const sendPush = vi.fn(async () => result);
    const { createApp } = await import("../app.js");
    const app = createApp(ctx.db, undefined, { vapidPublicKey: "public-key", sendPush });
    return { app, sendPush };
  }

  it("hands out the server's public key for subscribing", async () => {
    const { app } = await appWith();
    const res = await request(app).get("/api/notifications/vapid-public-key");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ publicKey: "public-key" });
  });

  it("generates and keeps one key pair when the entrypoint didn't supply one", async () => {
    ctx = createTestDb();
    const { createApp } = await import("../app.js");
    const first = await request(createApp(ctx.db)).get("/api/notifications/vapid-public-key");
    const second = await request(createApp(ctx.db)).get("/api/notifications/vapid-public-key");
    expect(first.body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(second.body.publicKey).toBe(first.body.publicKey);
  });

  it("subscribes a device, and re-subscribing it updates rather than duplicates", async () => {
    const { app } = await appWith();

    const first = await request(app).post("/api/notifications/subscriptions").send(subscription);
    expect(first.status).toBe(201);
    await request(app)
      .post("/api/notifications/subscriptions")
      .send({ ...subscription, keys: { p256dh: "rotated", auth: "rotated-auth" } });

    const stored = listSubscriptions(ctx.db);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ endpoint: ENDPOINT, p256dh: "rotated", auth: "rotated-auth" });
  });

  it("rejects a subscription that isn't a push service https URL with keys", async () => {
    const { app } = await appWith();

    for (const body of [
      { ...subscription, endpoint: "http://192.168.1.5/push" },
      { ...subscription, endpoint: "not a url" },
      { endpoint: ENDPOINT },
    ]) {
      const res = await request(app).post("/api/notifications/subscriptions").send(body);
      expect(res.status).toBe(400);
    }
    expect(listSubscriptions(ctx.db)).toEqual([]);
  });

  it("unsubscribes a device, and unsubscribing twice is fine", async () => {
    const { app } = await appWith();
    upsertSubscription(ctx.db, { endpoint: ENDPOINT, p256dh: "k", auth: "a" });

    for (let i = 0; i < 2; i++) {
      const res = await request(app).delete("/api/notifications/subscriptions").send({ endpoint: ENDPOINT });
      expect(res.status).toBe(204);
    }
    expect(listSubscriptions(ctx.db)).toEqual([]);
  });

  it("sends a test notification to the asking device", async () => {
    const { app, sendPush } = await appWith("ok");
    upsertSubscription(ctx.db, { endpoint: ENDPOINT, p256dh: "k", auth: "a" });

    const res = await request(app).post("/api/notifications/test").send({ endpoint: ENDPOINT });

    expect(res.status).toBe(204);
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: ENDPOINT }),
      expect.objectContaining({ title: "Notifications are on" }),
      expect.anything(),
    );
  });

  it("says so when a test is asked for by a device that isn't subscribed", async () => {
    const { app, sendPush } = await appWith();
    const res = await request(app).post("/api/notifications/test").send({ endpoint: ENDPOINT });
    expect(res.status).toBe(404);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("forgets the device and says so when the push service reports its subscription gone", async () => {
    const { app } = await appWith("gone");
    upsertSubscription(ctx.db, { endpoint: ENDPOINT, p256dh: "k", auth: "a" });
    ctx.db.update(pushSubscriptions).set({ createdAt: "2026-01-01 00:00:00" }).run();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await request(app).post("/api/notifications/test").send({ endpoint: ENDPOINT });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/turn notifications on again/);
    expect(listSubscriptions(ctx.db)).toEqual([]);
  });

  it("keeps a device that only just subscribed when the push service calls it gone, and asks for a retry", async () => {
    const { app } = await appWith("gone");
    upsertSubscription(ctx.db, { endpoint: ENDPOINT, p256dh: "k", auth: "a" });

    const res = await request(app).post("/api/notifications/test").send({ endpoint: ENDPOINT });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/try again in a moment/);
    expect(listSubscriptions(ctx.db)).toHaveLength(1);
  });

  it("reports a push service that refused the test, keeping the device", async () => {
    const { app } = await appWith("failed");
    upsertSubscription(ctx.db, { endpoint: ENDPOINT, p256dh: "k", auth: "a" });

    const res = await request(app).post("/api/notifications/test").send({ endpoint: ENDPOINT });

    expect(res.status).toBe(502);
    expect(listSubscriptions(ctx.db)).toHaveLength(1);
  });

  it("requires a login when auth is on", async () => {
    process.env.AUTH_ENABLED = "true";
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 4);
    const { app } = await appWith();

    expect((await request(app).get("/api/notifications/vapid-public-key")).status).toBe(401);
    expect(
      (await request(app).post("/api/notifications/subscriptions").send(subscription)).status,
    ).toBe(401);
    expect(listSubscriptions(ctx.db)).toEqual([]);
  });
});
