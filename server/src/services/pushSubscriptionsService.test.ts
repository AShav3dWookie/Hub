import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { pushSubscriptions } from "../db/schema.js";
import type { PushSendResult, PushSender } from "../lib/webPush.js";
import {
  NEW_SUBSCRIPTION_GRACE_MS,
  listSubscriptions,
  sendTestNotification,
  upsertSubscription,
} from "./pushSubscriptionsService.js";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";

/** A sender that answers with each result in turn, repeating the last. */
function answering(...results: PushSendResult[]) {
  let calls = 0;
  return vi.fn<PushSender>(async () => results[Math.min(calls++, results.length - 1)]);
}

describe("sendTestNotification", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
  });

  function subscribedAt(createdAt: string) {
    ctx = createTestDb();
    upsertSubscription(ctx.db, { endpoint: ENDPOINT, p256dh: "k", auth: "a" });
    ctx.db.update(pushSubscriptions).set({ createdAt }).run();
    return Date.parse(`${createdAt.replace(" ", "T")}Z`);
  }

  it("retries a brand-new device the push service refuses, and succeeds without bothering the user", async () => {
    const createdMs = subscribedAt("2026-09-15 21:00:00");
    const send = answering("gone", "ok");

    const result = await sendTestNotification(ctx.db, ENDPOINT, send, { nowMs: createdMs + 3000, retryDelayMs: 0 });

    expect(result).toBe("ok");
    expect(send).toHaveBeenCalledTimes(2);
    expect(listSubscriptions(ctx.db)).toHaveLength(1);
  });

  it("gives up after one retry and asks the user to try again, keeping the new device", async () => {
    const createdMs = subscribedAt("2026-09-15 21:00:00");
    const send = answering("gone");

    const result = await sendTestNotification(ctx.db, ENDPOINT, send, { nowMs: createdMs + 3000, retryDelayMs: 0 });

    expect(result).toBe("failed");
    expect(send).toHaveBeenCalledTimes(2);
    expect(listSubscriptions(ctx.db)).toHaveLength(1);
  });

  it("doesn't retry an established device the push service calls gone — it removes it", async () => {
    const createdMs = subscribedAt("2026-09-15 21:00:00");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = answering("gone");

    const result = await sendTestNotification(ctx.db, ENDPOINT, send, {
      nowMs: createdMs + NEW_SUBSCRIPTION_GRACE_MS,
      retryDelayMs: 0,
    });

    expect(result).toBe("gone");
    expect(send).toHaveBeenCalledOnce();
    expect(listSubscriptions(ctx.db)).toEqual([]);
  });

  it("sends once when the push service accepts straight away", async () => {
    const createdMs = subscribedAt("2026-09-15 21:00:00");
    const send = answering("ok");

    expect(await sendTestNotification(ctx.db, ENDPOINT, send, { nowMs: createdMs + 1000 })).toBe("ok");
    expect(send).toHaveBeenCalledOnce();
    expect(listSubscriptions(ctx.db)[0].lastSuccessAt).not.toBeNull();
  });
});
