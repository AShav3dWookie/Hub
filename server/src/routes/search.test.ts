import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";
import { createLog } from "../services/logService.js";

describe("search route", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  function setup() {
    ctx = createTestDb();
    createLog(ctx.db, {
      category: "movie",
      title: "Inception",
      releaseYear: 2010,
      rating: 5,
      date: "2024-01-01",
      notes: null,
      people: [{ name: "Sarah" }],
    });
    return createApp(ctx.db);
  }

  it("returns entity-grouped results by default", async () => {
    const app = setup();
    const res = await request(app).get("/api/search");
    expect(res.status).toBe(200);
    expect(res.body.groupBy).toBe("entity");
    expect(res.body.entities[0].title).toBe("Inception");
  });

  it("coerces numeric query params from the query string", async () => {
    const app = setup();
    const res = await request(app).get("/api/search?ratingMin=5&releaseYearMin=2000");
    expect(res.status).toBe(200);
    expect(res.body.entities).toHaveLength(1);
  });

  it("400s on a non-numeric rating filter", async () => {
    const app = setup();
    const res = await request(app).get("/api/search?ratingMin=abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("400s on an out-of-range release year", async () => {
    const app = setup();
    expect((await request(app).get("/api/search?releaseYearMin=1000")).status).toBe(400);
  });

  it("400s on an unknown groupBy enum", async () => {
    const app = setup();
    expect((await request(app).get("/api/search?groupBy=weird")).status).toBe(400);
  });

  it("keyword-filters via ?q", async () => {
    const app = setup();
    const res = await request(app).get("/api/search?q=incep&groupBy=log");
    expect(res.body.logs).toHaveLength(1);
  });
});
