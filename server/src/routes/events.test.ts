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
});
