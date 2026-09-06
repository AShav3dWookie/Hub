import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createTestDb } from "./testUtils/testDb.js";

describe("app", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    ctx?.cleanup();
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_PASSWORD_HASH;
    delete process.env.TRUST_PROXY;
  });

  it("responds to /api/health", async () => {
    ctx = createTestDb();
    const { createApp } = await import("./app.js");
    const app = createApp(ctx.db);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("allows unauthenticated API access when AUTH_ENABLED is not set", async () => {
    ctx = createTestDb();
    const { createApp } = await import("./app.js");
    const app = createApp(ctx.db);
    const res = await request(app).get("/api/search");
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated API access when AUTH_ENABLED=true, and allows access after login", async () => {
    process.env.AUTH_ENABLED = "true";
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 10);
    ctx = createTestDb();
    const { createApp } = await import("./app.js");
    const app = createApp(ctx.db);

    const blocked = await request(app).get("/api/search");
    expect(blocked.status).toBe(401);

    const agent = request.agent(app);
    const badLogin = await agent.post("/api/auth/login").send({ password: "wrong" });
    expect(badLogin.status).toBe(401);

    const goodLogin = await agent.post("/api/auth/login").send({ password: "correct-horse" });
    expect(goodLogin.status).toBe(200);

    const allowed = await agent.get("/api/search");
    expect(allowed.status).toBe(200);
  });

  it("sets a hardened, persistent session cookie on login", async () => {
    process.env.AUTH_ENABLED = "true";
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 10);
    process.env.SESSION_SECRET = "Zt7Qw1cVb9xK4pR2sN6hJ8mL0dF3gY5aU7eO1iC2kP4";
    ctx = createTestDb();
    const { createApp } = await import("./app.js");
    const app = createApp(ctx.db);

    const login = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send({ password: "correct-horse" });
    expect(login.status).toBe(200);

    const cookie = [login.headers["set-cookie"]].flat().join("\n");
    expect(cookie).toMatch(/logger\.sid=/);
    expect(cookie).toMatch(/httponly/i);
    expect(cookie).toMatch(/samesite=lax/i);
    expect(cookie).toMatch(/expires=/i); // persistent, not a session cookie
    expect(cookie).toMatch(/\bsecure\b/i); // proxy said https

    delete process.env.SESSION_SECRET;
  });

  it("omits Secure from the session cookie when the request is plain HTTP", async () => {
    process.env.AUTH_ENABLED = "true";
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 10);
    process.env.SESSION_SECRET = "Zt7Qw1cVb9xK4pR2sN6hJ8mL0dF3gY5aU7eO1iC2kP4";
    ctx = createTestDb();
    const { createApp } = await import("./app.js");
    const app = createApp(ctx.db);

    const login = await request(app).post("/api/auth/login").send({ password: "correct-horse" });
    expect(login.status).toBe(200);

    const cookie = [login.headers["set-cookie"]].flat().join("\n");
    expect(cookie).toMatch(/logger\.sid=/);
    expect(cookie).not.toMatch(/\bsecure\b/i);

    delete process.env.SESSION_SECRET;
  });
});
