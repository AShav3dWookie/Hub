import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { logs } from "../db/schema.js";
import { createLog } from "../services/logService.js";

/** YYYY-MM-DD offset from today by whole days. */
function isoOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("events route", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("returns empty buckets when there are no events", async () => {
    ctx = createTestDb();
    const res = await request(createApp(ctx.db)).get("/api/events/upcoming");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ today: [], next7Days: [] });
  });

  it("surfaces a future hang-out and sweeps an expired auto-delete appointment", async () => {
    ctx = createTestDb();
    const app = createApp(ctx.db);

    createLog(ctx.db, {
      category: "hang_out",
      title: "Bowling",
      rating: null,
      date: isoOffset(2),
      notes: null,
      people: [{ name: "Sam" }],
    });
    const expired = createLog(ctx.db, {
      category: "appointment",
      title: "Old dentist",
      rating: null,
      date: isoOffset(-1),
      notes: null,
      people: [],
      autoDelete: true,
    });

    const res = await request(app).get("/api/events/upcoming");
    expect(res.status).toBe(200);
    expect(res.body.next7Days).toHaveLength(1);
    expect(res.body.next7Days[0]).toMatchObject({ entityTitle: "Bowling", category: "hang_out" });

    // The GET also ran the sweep.
    expect(ctx.db.select().from(logs).where(eq(logs.id, expired.id)).get()).toBeUndefined();
  });

  it("carries an appointment's time from the form to Home and the calendar, timed ones after the rest", async () => {
    ctx = createTestDb();
    const app = createApp(ctx.db);
    const date = isoOffset(3);
    const add = (title: string, time?: string) =>
      request(app)
        .post("/api/logs")
        .send({ category: "appointment", title, date, rating: null, notes: null, people: [], time });

    const dentist = await add("Dentist", "15:00");
    expect(dentist.status).toBe(201);
    expect(dentist.body.time).toBe("15:00");
    await add("Bins");
    await add("Haircut", "09:30");

    const upcoming = await request(app).get("/api/events/upcoming");
    expect(upcoming.body.next7Days.map((e: { entityTitle: string; time: string | null }) => [e.entityTitle, e.time])).toEqual([
      ["Bins", null],
      ["Haircut", "09:30"],
      ["Dentist", "15:00"],
    ]);

    const calendar = await request(app).get(`/api/calendar?from=${date}&to=${date}`);
    expect(calendar.body.items.map((i: { title: string; time: string | null }) => [i.title, i.time])).toEqual([
      ["Bins", null],
      ["Haircut", "09:30"],
      ["Dentist", "15:00"],
    ]);

    const moved = await request(app)
      .put(`/api/logs/${dentist.body.id}`)
      .send({ date, rating: null, notes: null, people: [], time: "08:00" });
    expect(moved.body.time).toBe("08:00");
    expect((await request(app).put(`/api/logs/${dentist.body.id}`).send({ date, time: "8am" })).status).toBe(400);
  });
});
