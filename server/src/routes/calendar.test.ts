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
  });
});
