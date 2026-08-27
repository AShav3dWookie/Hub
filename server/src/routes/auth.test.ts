import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createTestDb } from "../testUtils/testDb.js";
import { createApp } from "../app.js";

// These cover the AUTH_ENABLED=false default path (no env juggling needed).
// The auth-enabled login/session flow is covered in app.test.ts.
describe("auth routes (auth disabled)", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  function setup() {
    ctx = createTestDb();
    return createApp(ctx.db);
  }

  it("GET /api/auth/status reports no auth requirement", async () => {
    const res = await request(setup()).get("/api/auth/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authRequired: false, authenticated: true });
  });

  it("POST /api/auth/login short-circuits to authenticated without a password", async () => {
    const res = await request(setup()).post("/api/auth/login").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ authenticated: true, authRequired: false });
  });

  it("POST /api/auth/logout clears the session and returns 204", async () => {
    const res = await request(setup()).post("/api/auth/logout");
    expect(res.status).toBe(204);
  });
});
