import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../testUtils/testDb.js";
import type { AppDb } from "../db/client.js";
import { logs, notificationDeliveries, pushSubscriptions } from "../db/schema.js";
import type { PushPayload, PushSendResult, PushSender } from "../lib/webPush.js";
import { findOrCreateEntity } from "./entityService.js";
import { createEntityNote } from "./entityNotesService.js";
import { createLog } from "./logService.js";
import { listSubscriptions, upsertSubscription } from "./pushSubscriptionsService.js";
import { DELIVERY_RETENTION_DAYS, runNotificationTick } from "./notificationScheduler.js";
import { listLogs } from "./serverLogService.js";

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

/** Make every subscription older than the new-subscription grace period. */
function subscribedLongAgo(db: AppDb) {
  db.update(pushSubscriptions).set({ createdAt: "2026-01-01 00:00:00" }).run();
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
  time: string | null = null,
) {
  const log = createLog(db, { category, title, rating: null, date, notes: null, people, time });
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
    subscribedLongAgo(ctx.db);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    const { send } = fakeSender((endpoint) => (endpoint.endsWith("uninstalled") ? "gone" : "ok"));

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });

    const remaining = listSubscriptions(ctx.db);
    expect(remaining.map((s) => s.endpoint)).toEqual(["https://push.example/phone"]);
    expect(remaining[0].lastSuccessAt).not.toBeNull();
  });

  it("doesn't believe a push service that calls a moments-old subscription gone, and retries it", async () => {
    ctx = createTestDb();
    subscribe(ctx.db, "https://push.example/just-subscribed");
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    // FCM really does this: 410 for the first send to a fresh subscription, then 201.
    let first = true;
    const { send, sent } = fakeSender(() => (first ? ((first = false), "gone") : "ok"));

    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });
    expect(listSubscriptions(ctx.db)).toHaveLength(1);

    await runNotificationTick(ctx.db, at("2026-09-14T20:01:00Z"), { timeZone: TZ, send });
    expect(sent).toHaveLength(2);
    expect(listSubscriptions(ctx.db)[0].lastSuccessAt).not.toBeNull();
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

  describe("timed appointments", () => {
    // Dentist at 15:00 London time on Tuesday 15 September, which is 14:00Z in BST.
    const dentist = (db: AppDb) => plannedEvent(db, "Dentist", "2026-09-15", "appointment", [], "15:00");

    it("reminds an hour before, naming the time, and not a minute earlier", async () => {
      ctx = createTestDb();
      subscribe(ctx.db);
      dentist(ctx.db);
      const { send, sent } = fakeSender();

      await runNotificationTick(ctx.db, at("2026-09-15T12:59:00Z"), { timeZone: TZ, send });
      expect(sent).toEqual([]);

      await runNotificationTick(ctx.db, at("2026-09-15T13:00:00Z"), { timeZone: TZ, send });
      expect(sent.map((s) => [s.payload.title, s.payload.body, s.ttlSeconds])).toEqual([
        ["In an hour", "Dentist at 15:00", 3600],
      ]);
    });

    it("sends nothing once it has started", async () => {
      ctx = createTestDb();
      subscribe(ctx.db);
      dentist(ctx.db);
      const { send, sent } = fakeSender();

      await runNotificationTick(ctx.db, at("2026-09-15T14:00:00Z"), { timeZone: TZ, send });
      await runNotificationTick(ctx.db, at("2026-09-15T14:30:00Z"), { timeZone: TZ, send });
      expect(sent).toEqual([]);
    });

    it("sends a late reminder inside the hour, expiring at the start, and never twice", async () => {
      ctx = createTestDb();
      subscribe(ctx.db);
      dentist(ctx.db);
      const { send, sent } = fakeSender();

      await runNotificationTick(ctx.db, at("2026-09-15T13:40:00Z"), { timeZone: TZ, send });
      await runNotificationTick(ctx.db, at("2026-09-15T13:41:00Z"), { timeZone: TZ, send });
      await runNotificationTick(ctx.db, at("2026-09-15T13:59:00Z"), { timeZone: TZ, send });
      expect(sent.map((s) => [s.payload.body, s.ttlSeconds])).toEqual([["Dentist at 15:00", 20 * 60]]);
    });

    it("is left out of the 9am reminder, which still names the untimed ones", async () => {
      ctx = createTestDb();
      subscribe(ctx.db);
      dentist(ctx.db);
      plannedEvent(ctx.db, "Haircut", "2026-09-15");
      const { send, sent } = fakeSender();

      await runNotificationTick(ctx.db, at("2026-09-15T08:00:00Z"), { timeZone: TZ, send });
      expect(sent.map((s) => [s.payload.title, s.payload.body])).toEqual([["Today", "Haircut"]]);
    });

    it("is still named the night before, with its time", async () => {
      ctx = createTestDb();
      subscribe(ctx.db);
      dentist(ctx.db);
      const { send, sent } = fakeSender();

      await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send });
      expect(sent.map((s) => [s.payload.title, s.payload.body])).toEqual([["Tomorrow", "Dentist at 15:00"]]);
    });

    it("reminds once for an early-morning appointment whose hour starts the day before", async () => {
      ctx = createTestDb();
      subscribe(ctx.db);
      plannedEvent(ctx.db, "Flight", "2026-09-16", "appointment", [], "00:30");
      const { send, sent } = fakeSender();

      // 23:30 and 00:10 London time, either side of midnight.
      await runNotificationTick(ctx.db, at("2026-09-15T22:30:00Z"), { timeZone: TZ, send });
      await runNotificationTick(ctx.db, at("2026-09-15T23:10:00Z"), { timeZone: TZ, send });
      expect(sent.filter((s) => s.payload.title === "In an hour").map((s) => s.payload.body)).toEqual([
        "Flight at 00:30",
      ]);
    });

    it("waits for a device, and retries when none accepted it", async () => {
      ctx = createTestDb();
      dentist(ctx.db);
      const refused = fakeSender("failed");
      await runNotificationTick(ctx.db, at("2026-09-15T13:00:00Z"), { timeZone: TZ, send: refused.send });

      subscribe(ctx.db);
      await runNotificationTick(ctx.db, at("2026-09-15T13:01:00Z"), { timeZone: TZ, send: refused.send });
      expect(refused.sent).toHaveLength(1);

      const { send, sent } = fakeSender();
      await runNotificationTick(ctx.db, at("2026-09-15T13:02:00Z"), { timeZone: TZ, send });
      expect(sent.map((s) => s.payload.body)).toEqual(["Dentist at 15:00"]);
    });
  });
});

describe("runNotificationTick's log", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  it("records each reminder sent, and a reminder no device takes once an hour", async () => {
    ctx = createTestDb();
    subscribe(ctx.db);
    plannedEvent(ctx.db, "Dentist", "2026-09-15");
    await runNotificationTick(ctx.db, at("2026-09-14T20:00:00Z"), { timeZone: TZ, send: fakeSender().send });
    expect(listLogs(ctx.db, { source: "notifications" }).map((e) => e.message)).toEqual([
      'Sent "Tomorrow: Dentist" to 1 of 1 device(s)',
    ]);

    plannedEvent(ctx.db, "Physio", "2026-09-15");
    const { send } = fakeSender("failed");
    for (const minute of ["01", "02", "03"]) {
      await runNotificationTick(ctx.db, at(`2026-09-14T20:${minute}:00Z`), { timeZone: TZ, send });
    }
    expect(listLogs(ctx.db, { source: "notifications", level: "warn" })).toEqual([
      expect.objectContaining({ message: 'No device accepted "Tomorrow: Physio"; retrying each minute' }),
    ]);
  });
});
