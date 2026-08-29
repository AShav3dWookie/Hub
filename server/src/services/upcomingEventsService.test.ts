import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../testUtils/testDb.js";
import type { AppDb } from "../db/client.js";
import { logs } from "../db/schema.js";
import { createLog } from "./logService.js";
import { getUpcomingEvents, sweepExpiredAppointments } from "./upcomingEventsService.js";

const NOW = new Date("2024-06-15T12:00:00Z");

/** createLog stamps createdAt with the real clock; override it so tests can control "logged before". */
function backdateCreatedAt(db: AppDb, logId: number, iso: string) {
  db.update(logs).set({ createdAt: iso }).where(eq(logs.id, logId)).run();
}

describe("upcomingEventsService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  describe("getUpcomingEvents", () => {
    it("buckets hang-outs and appointments by date, with people on hang-outs", () => {
      ctx = createTestDb();
      const bowling = createLog(ctx.db, {
        category: "hang_out",
        title: "Bowling",
        rating: null,
        date: "2024-06-15",
        notes: null,
        people: [{ name: "Sam" }],
      });
      const dentist = createLog(ctx.db, {
        category: "appointment",
        title: "Dentist",
        rating: null,
        date: "2024-06-20",
        notes: "10am",
        people: [],
        autoDelete: true,
      });
      backdateCreatedAt(ctx.db, bowling.id, "2024-06-01");
      backdateCreatedAt(ctx.db, dentist.id, "2024-06-01");

      const result = getUpcomingEvents(ctx.db, NOW);

      expect(result.today).toHaveLength(1);
      expect(result.today[0].entityTitle).toBe("Bowling");
      expect(result.today[0].category).toBe("hang_out");
      expect(result.today[0].people.map((p) => p.name)).toEqual(["Sam"]);

      expect(result.next7Days).toHaveLength(1);
      expect(result.next7Days[0].entityTitle).toBe("Dentist");
      expect(result.next7Days[0].people).toEqual([]);
    });

    it("includes day +7 but excludes day +8 and past dates", () => {
      ctx = createTestDb();
      for (const [title, date] of [
        ["Edge in", "2024-06-22"],
        ["Edge out", "2024-06-23"],
        ["Past", "2024-06-14"],
      ] as const) {
        const created = createLog(ctx.db, {
          category: "hang_out",
          title,
          rating: null,
          date,
          notes: null,
          people: [],
        });
        backdateCreatedAt(ctx.db, created.id, "2024-06-01");
      }

      const result = getUpcomingEvents(ctx.db, NOW);

      expect(result.today).toHaveLength(0);
      expect(result.next7Days.map((e) => e.entityTitle)).toEqual(["Edge in"]);
    });

    it("includes an event that was logged before its date", () => {
      ctx = createTestDb();
      const planned = createLog(ctx.db, {
        category: "hang_out",
        title: "Planned bowling",
        rating: null,
        date: "2024-06-15",
        notes: null,
        people: [],
      });
      backdateCreatedAt(ctx.db, planned.id, "2024-06-10");

      expect(getUpcomingEvents(ctx.db, NOW).today.map((e) => e.entityTitle)).toEqual([
        "Planned bowling",
      ]);
    });

    it("excludes an event logged on or after the day it happened", () => {
      ctx = createTestDb();
      const sameDay = createLog(ctx.db, {
        category: "hang_out",
        title: "Retro bowling",
        rating: null,
        date: "2024-06-15",
        notes: null,
        people: [],
      });
      const afterwards = createLog(ctx.db, {
        category: "appointment",
        title: "Backfilled dentist",
        rating: null,
        date: "2024-06-18",
        notes: null,
        people: [],
      });
      backdateCreatedAt(ctx.db, sameDay.id, "2024-06-15"); // logged the day of
      backdateCreatedAt(ctx.db, afterwards.id, "2024-06-20"); // logged after the fact

      const result = getUpcomingEvents(ctx.db, NOW);
      expect(result.today).toHaveLength(0);
      expect(result.next7Days).toHaveLength(0);
    });

    it("ignores non-event categories", () => {
      ctx = createTestDb();
      createLog(ctx.db, {
        category: "movie",
        title: "Dune",
        rating: 5,
        date: "2024-06-16",
        notes: null,
        people: [],
      });

      const result = getUpcomingEvents(ctx.db, NOW);

      expect(result.today).toHaveLength(0);
      expect(result.next7Days).toHaveLength(0);
    });
  });

  describe("sweepExpiredAppointments", () => {
    it("deletes only auto-delete appointments dated before today", () => {
      ctx = createTestDb();
      const expired = createLog(ctx.db, {
        category: "appointment",
        title: "Old dentist",
        rating: null,
        date: "2024-06-14",
        notes: null,
        people: [],
        autoDelete: true,
      });
      const keptNoFlag = createLog(ctx.db, {
        category: "appointment",
        title: "Kept dentist",
        rating: null,
        date: "2024-06-14",
        notes: null,
        people: [],
        autoDelete: false,
      });
      const future = createLog(ctx.db, {
        category: "appointment",
        title: "Future dentist",
        rating: null,
        date: "2024-06-20",
        notes: null,
        people: [],
        autoDelete: true,
      });
      const hangOut = createLog(ctx.db, {
        category: "hang_out",
        title: "Old bowling",
        rating: null,
        date: "2024-06-14",
        notes: null,
        people: [],
      });

      const removed = sweepExpiredAppointments(ctx.db, NOW);

      expect(removed).toBe(1);
      const remaining = ctx.db.select({ id: logs.id }).from(logs).all().map((r) => r.id);
      expect(remaining).toEqual(
        expect.arrayContaining([keptNoFlag.id, future.id, hangOut.id]),
      );
      expect(ctx.db.select().from(logs).where(eq(logs.id, expired.id)).get()).toBeUndefined();
    });

    it("returns 0 and deletes nothing when there is nothing to sweep", () => {
      ctx = createTestDb();
      createLog(ctx.db, {
        category: "appointment",
        title: "Tomorrow",
        rating: null,
        date: "2024-06-16",
        notes: null,
        people: [],
        autoDelete: true,
      });

      expect(sweepExpiredAppointments(ctx.db, NOW)).toBe(0);
      expect(ctx.db.select().from(logs).all()).toHaveLength(1);
    });
  });
});
