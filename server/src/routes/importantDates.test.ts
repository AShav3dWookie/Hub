import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { findOrCreateEntity } from "../services/entityService.js";
import { createEntityNote } from "../services/entityNotesService.js";

describe("important dates route", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("returns empty buckets when there are no important_date notes", async () => {
    ctx = createTestDb();
    const app = createApp(ctx.db);
    const res = await request(app).get("/api/important-dates/upcoming");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ today: [], next7Days: [] });
  });

  it("surfaces a note whose annual recurrence lands today", async () => {
    ctx = createTestDb();
    const app = createApp(ctx.db);
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");

    const now = new Date();
    const md = `${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    createEntityNote(ctx.db, sarah.id, {
      category: "important_date",
      body: "",
      tag: "Birthday",
      eventDate: `1990-${md}`,
    });

    const res = await request(app).get("/api/important-dates/upcoming");
    expect(res.status).toBe(200);
    expect(res.body.today).toHaveLength(1);
    expect(res.body.today[0]).toMatchObject({ entityName: "Sarah", tag: "Birthday" });
  });
});
