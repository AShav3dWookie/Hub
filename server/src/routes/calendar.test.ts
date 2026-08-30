import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { createLog } from "../services/logService.js";
import { findOrCreateEntity } from "../services/entityService.js";
import { createEntityNote } from "../services/entityNotesService.js";

describe("calendar routes", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => ctx?.cleanup());

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }

  it("returns a mixed range and echoes from/to", async () => {
    const app = setup();
    createLog(ctx.db, {
      category: "hang_out",
      title: "Bowling",
      rating: null,
      date: "2024-08-12",
      notes: "7pm",
      people: [],
    });
    const alice = findOrCreateEntity(ctx.db, "person", "Alice");
    createEntityNote(ctx.db, alice.id, {
      category: "important_date",
      tag: "Birthday",
      eventDate: "1990-08-20",
      body: "",
    });

    const res = await request(app).get("/api/calendar?from=2024-08-01&to=2024-08-31");
    expect(res.status).toBe(200);
    expect(res.body.from).toBe("2024-08-01");
    expect(res.body.to).toBe("2024-08-31");
    expect(res.body.items.map((i: { kind: string }) => i.kind).sort()).toEqual([
      "important_date",
      "log",
    ]);
  });

  it("400s on missing / malformed / oversized params", async () => {
    const app = setup();
    expect((await request(app).get("/api/calendar")).status).toBe(400);
    expect((await request(app).get("/api/calendar?from=2024-08-01")).status).toBe(400);
    expect((await request(app).get("/api/calendar?from=2024-8-1&to=2024-08-31")).status).toBe(400);
    expect((await request(app).get("/api/calendar?from=2024-08-31&to=2024-08-01")).status).toBe(400);
    expect((await request(app).get("/api/calendar?from=2024-01-01&to=2024-12-31")).status).toBe(400);
    expect((await request(app).get("/api/calendar?from=2023-02-29&to=2023-03-05")).status).toBe(400);
  });

  it("surfaces a birthday every year the caller navigates to, and never on movies", async () => {
    const app = setup();
    const alice = findOrCreateEntity(ctx.db, "person", "Alice");
    createEntityNote(ctx.db, alice.id, {
      category: "important_date",
      tag: "Birthday",
      eventDate: "1990-03-14",
      body: "",
    });
    createLog(ctx.db, {
      category: "movie",
      title: "Dune",
      rating: 5,
      date: "2025-03-14",
      notes: null,
      people: [],
    });

    for (const year of [2024, 2025, 2031]) {
      const res = await request(app).get(`/api/calendar?from=${year}-03-01&to=${year}-03-31`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ date: `${year}-03-14`, kind: "important_date" });
    }
  });

  it("a consecutive month walk keeps each event in exactly one month", async () => {
    const app = setup();
    createLog(ctx.db, { category: "hang_out", title: "Bowling", rating: null, date: "2024-06-30", notes: null, people: [] });
    createLog(ctx.db, { category: "eating_out", title: "Dinner", rating: null, date: "2024-07-01", notes: null, people: [] });

    // June grid: 2024-05-27 .. 2024-07-07 ; July grid: 2024-07-01 .. 2024-08-04
    const june = (await request(app).get("/api/calendar?from=2024-06-01&to=2024-06-30")).body;
    const july = (await request(app).get("/api/calendar?from=2024-07-01&to=2024-07-31")).body;
    expect(june.items.map((i: { title: string }) => i.title)).toEqual(["Bowling"]);
    expect(july.items.map((i: { title: string }) => i.title)).toEqual(["Dinner"]);
  });
});
