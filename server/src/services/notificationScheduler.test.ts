import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../testUtils/testDb.js";
import type { AppDb } from "../db/client.js";
import { logs, notificationDeliveries } from "../db/schema.js";
import type { PushPayload, PushSendResult, PushSender } from "../lib/webPush.js";
import { findOrCreateEntity } from "./entityService.js";
import { createEntityNote } from "./entityNotesService.js";
import { createLog } from "./logService.js";
import { listSubscriptions, upsertSubscription } from "./pushSubscriptionsService.js";
import { DELIVERY_RETENTION_DAYS, runNotificationTick } from "./notificationScheduler.js";

const TZ = "Europe/London";

/**
 * London is on BST (UTC+1) through September, so 20:00Z is 9pm local. The dates below are chosen
 * around Monday 2026-09-14.
 */
const at = (iso: string) => new Date(iso);

interface Sent {
  endpoint: string;
  payload: PushPayload;
  ttlSeconds: number;
}

function fakeSender(result: PushSendResult | ((endpoint: string) => PushSendResult) = "ok") {
  const sent: Sent[] = [];
  const send: PushSender = async (target, payload, { ttlSeconds }) => {
    sent.push({ endpoint: target.endpoint, payload, ttlSeconds });
    return typeof result === "function" ? result(target.endpoint) : result;
  };
  return { send, sent };
}

function subscribe(db: AppDb, endpoint = "https://push.example/device-1") {
  upsertSubscription(db, { endpoint, p256dh: "p256dh-key", auth: "auth-secret" });
}

function birthday(db: AppDb, name: string, eventDate: string, tag = "Birthday") {
  const person = findOrCreateEntity(db, "person", name);
  createEntityNote(db, person.id, { category: "important_date", body: "", tag, eventDate });
}

function plannedEvent(
  db: AppDb,
  title: string,
  date: string,
  category: "hang_out" | "appointment" = "appointment",
  people: { name: string }[] = [],
) {
  const log = createLog(db, { category, title, rating: null, date, notes: null, people });
  db.update(logs).set({ createdAt: "2026-09-01 10:00:00" }).where(eq(logs.id, log.id)).run();
  return log;
}

describe("notificationScheduler", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
  });

  it("reminds about tomorrow at 9pm local time, and not a minute earlier", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const { send, sent } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-14T19:59:00Z"), { timeZone: TZ, send });
    expect(sent).toEqual([]);

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });
    expect(sent.map((s) => s.payload)).toEqual([
      expect.objectContaining({ title: "Tomorrow", body: "Dentist", url: "/" }),
    ]);
  });

  it("times the evening reminder in GMT once the clocks go back", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-10-27");
    const { send, sent } = fakeSender();

    // 2026-10-26 is GMT: 20:00Z is 8pm local, 21:00Z is 9pm.
    await runNotificationTick(ctx.db, at("2026-10-26T20:00:00Z"), { timeZone: TZ, send });
    expect(sent).toEqual([]);
    await runNotificationTick(ctx.db, at("2026-10-26T21:00:00Z"), { timeZone: TZ, send });
    expect(sent).toHaveLength(1);
  });

  it("never announces the same thing twice", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const { send, sent } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });
    await runNotificationTick(ctx.db, at("2026-09-14T20:01:00Z"), { timeZone: TZ, send });
    await runNotificationTick(ctx.db, at("2026-09-14T22:30:00Z"), { timeZone: TZ, send });

    expect(sent).toHaveLength(1);
  });

  it("sends a missed evening reminder late, but never after midnight", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const late = fakeSender();

    // 23:30 local — the server was down at 9pm.
    await runNotificationTick(ctx.db, at("2026-09-14T22:30:00Z"), { timeZone: TZ, send: late.send });
    expect(late.sent.map((s) => s.payload.title)).toEqual(["Tomorrow"]);
    // Expires with the slot, half an hour later.
    expect(late.sent[0].ttlSeconds).toBe(30 * 60);

    ctx.cleanup();
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const tooLate = fakeSender();

    // 00:10 local on the 15th — the evening slot has closed, and the morning one isn't open yet.
    await runNotificationTick(ctx.db, at("2026-09-14T23:10:00Z"), { timeZone: TZ, send: tooLate.send });
    expect(tooLate.sent).toEqual([]);
  });

  it("gives something added after 9pm its own late reminder, without repeating the first", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const { send, sent } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });
    plannedEvent(ctx.db, "Bowling", "2026-09-15", "hang_out", [{ name: "Ada" }]);
    await runNotificationTick(ctx.db, at("2026-09-14T21:00:00Z"), { timeZone: TZ, send });

    expect(sent.map((s) => s.payload.body)).toEqual(["Dentist", "Bowling with Ada"]);
    // Distinct tags, so the late one doesn't replace the first on the phone.
    expect(sent[0].payload.tag).not.toBe(sent[1].payload.tag);
  });

  it("reminds about today at 9am, until midday", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const { send, sent } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-15T07:59:00Z"), { timeZone: TZ, send });
    expect(sent).toEqual([]);
    await runNotificationTick(ctx.db, at("2026-09-15T08:00:00Z"), { timeZone: TZ, send });
    expect(sent.map((s) => s.payload)).toEqual([
      expect.objectContaining({ title: "Today", body: "Dentist" }),
    ]);

    // A second Today item added after midday is not announced.
    plannedEvent(ctx.db, "Physio", "2026-09-15");
    await runNotificationTick(ctx.db, at("2026-09-15T11:00:00Z"), { timeZone: TZ, send });
    expect(sent).toHaveLength(1);
  });

  it("warns a week ahead of a birthday at 9am, alongside today's items in one notification", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    birthday(ctx.db, "Sarah", "1990-09-22");
    birthday(ctx.db, "Tom", "2015-09-22", "Anniversary");
    const { send, sent } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-15T08:00:00Z"), { timeZone: TZ, send });

    expect(sent.map((s) => s.payload)).toEqual([
      expect.objectContaining({ title: "Today", body: "Dentist\nIn a week: Sarah — Birthday" }),
    ]);
  });

  it("names a birthday the evening before and the morning of, as well as a week ahead", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    birthday(ctx.db, "Sarah", "1990-09-22");
    const { send, sent } = fakeSender();

    for (const iso of ["2026-09-15T08:00:00Z", "2026-09-21T20:00:00Z", "2026-09-22T08:00:00Z"]) {
      await runNotificationTick(ctx.db, at(iso), { timeZone: TZ, send });
    }

    expect(sent.map((s) => `${s.payload.title}: ${s.payload.body}`)).toEqual([
      "In a week: Sarah — Birthday",
      "Tomorrow: Sarah — Birthday",
      "Today: Sarah — Birthday",
    ]);
  });

  it("sends nothing on a day with nothing coming up", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    const { send, sent } = fakeSender();

    const result = await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });

    expect(result.notifications).toBe(0);
    expect(sent).toEqual([]);
  });

  it("records nothing when no device is subscribed, so a device subscribing later still hears", async () => {
    ctx = createTestDb();
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const { send, sent } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });
    expect(ctx.db.select().from(notificationDeliveries).all()).toEqual([]);

    subscribe(ctx.db);
    await runNotificationTick(ctx.db, at("2026-09-14T20:30:00Z"), { timeZone: TZ, send });
    expect(sent).toHaveLength(1);
  });

  it("sends to every device, and retries next tick when none accepted it", async () => {
    ctx = createTestDb();
    subscribe(ctx.db, "https://push.example/phone");
    subscribe(ctx.db, "https://push.example/tablet");
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    let outage = true;
    const { send, sent } = fakeSender(() => (outage ? "failed" : "ok"));

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });
    expect(sent.map((s) => s.endpoint)).toEqual([
      "https://push.example/phone",
      "https://push.example/tablet",
    ]);

    outage = false;
    await runNotificationTick(ctx.db, at("2026-09-14T20:01:00Z"), { timeZone: TZ, send });
    await runNotificationTick(ctx.db, at("2026-09-14T20:02:00Z"), { timeZone: TZ, send });
    expect(sent).toHaveLength(4);
  });

  it("forgets a device the push service reports gone, and keeps the rest", async () => {
    ctx = createTestDb();
    subscribe(ctx.db, "https://push.example/uninstalled");
    subscribe(ctx.db, "https://push.example/phone");
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const { send } = fakeSender((endpoint) => (endpoint.endsWith("uninstalled") ? "gone" : "ok"));

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });

    const remaining = listSubscriptions(ctx.db);
    expect(remaining.map((s) => s.endpoint)).toEqual(["https://push.example/phone"]);
    expect(remaining[0].lastSuccessAt).not.toBeNull();
  });

  it("does not remind about a hang-out logged after it happened", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    createLog(ctx.db, {
      category: "hang_out",
      title: "Bowling",
      rating: null,
      date: "2026-09-15",
      notes: null,
      people: [],
    });
    ctx.db.update(logs).set({ createdAt: "2026-09-16 10:00:00" }).run();
    const { send, sent } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-15T08:00:00Z"), { timeZone: TZ, send });

    expect(sent).toEqual([]);
  });

  it(`prunes delivery records older than ${DELIVERY_RETENTION_DAYS} days`, async () => {
    ctx = createTestDb();
    ctx.db
      .insert(notificationDeliveries)
      .values([
        { slot: "evening", firedOn: "2026-08-01", itemKey: "log:1", sentAt: "2026-08-01T20:00:00Z" },
        { slot: "evening", firedOn: "2026-09-10", itemKey: "log:2", sentAt: "2026-09-10T20:00:00Z" },
      ])
      .run();
    const { send } = fakeSender();

    await runNotificationTick(ctx.db, at("2026-09-14T12:00:00Z"), { timeZone: TZ, send });

    expect(ctx.db.select().from(notificationDeliveries).all().map((r) => r.itemKey)).toEqual(["log:2"]);
  });
});
