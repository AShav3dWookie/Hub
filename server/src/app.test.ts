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

  /** An auth-enabled app plus an agent already logged in with `correct-horse`. */
  async function loggedIn() {
    process.env.AUTH_ENABLED = "true";
    process.env.AUTH_PASSWORD_HASH = await bcrypt.hash("correct-horse", 10);
    ctx = createTestDb();
    const { createApp } = await import("./app.js");
    const app = createApp(ctx.db);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "correct-horse" });
    return { app, agent };
  }

  it("answers a malformed login with 400 rather than hanging", async () => {
    // Regression: these handlers await bcrypt, and Express 4 drops a rejected promise on the
    // floor — a thrown ZodError used to leave the request open until it timed out.
    const { app } = await loggedIn();
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
  });

  it("changing the password replaces the one from the environment", async () => {
    const { app, agent } = await loggedIn();

    const changed = await agent
      .post("/api/auth/password")
      .send({ currentPassword: "correct-horse", newPassword: "new-horse-battery" });
    expect(changed.status).toBe(204);

    const withOld = await request(app).post("/api/auth/login").send({ password: "correct-horse" });
    expect(withOld.status).toBe(401);

    const withNew = await request(app)
      .post("/api/auth/login")
      .send({ password: "new-horse-battery" });
    expect(withNew.status).toBe(200);
  });

  it("keeps the current session alive after a password change", async () => {
    const { agent } = await loggedIn();

    await agent
      .post("/api/auth/password")
      .send({ currentPassword: "correct-horse", newPassword: "new-horse-battery" });

    const stillIn = await agent.get("/api/search");
    expect(stillIn.status).toBe(200);
  });

  it("refuses a password change without the current password", async () => {
    const { app, agent } = await loggedIn();

    const res = await agent
      .post("/api/auth/password")
      .send({ currentPassword: "not-it", newPassword: "new-horse-battery" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Current password is incorrect" });

    // The old password still works, so nothing was written.
    const login = await request(app).post("/api/auth/login").send({ password: "correct-horse" });
    expect(login.status).toBe(200);
  });

  it("rejects a new password that is too short", async () => {
    const { agent } = await loggedIn();

    const res = await agent
      .post("/api/auth/password")
      .send({ currentPassword: "correct-horse", newPassword: "short" });
    expect(res.status).toBe(400);
  });

  it("refuses a password change from someone who is not logged in", async () => {
    const { app } = await loggedIn();

    const res = await request(app)
      .post("/api/auth/password")
      .send({ currentPassword: "correct-horse", newPassword: "new-horse-battery" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });
  });
});
