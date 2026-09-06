import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { appSettings } from "../db/schema.js";
import { getStoredPasswordHash, setStoredPasswordHash } from "./authCredentialsService.js";

describe("authCredentialsService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("reports no stored password on a fresh database", () => {
    ctx = createTestDb();
    expect(getStoredPasswordHash(ctx.db)).toBeNull();
  });

  it("stores a password hash and reads it back", () => {
    ctx = createTestDb();
    setStoredPasswordHash(ctx.db, "$2b$12$first");
    expect(getStoredPasswordHash(ctx.db)).toBe("$2b$12$first");
  });

  it("replaces the stored hash rather than accumulating rows", () => {
    ctx = createTestDb();
    setStoredPasswordHash(ctx.db, "$2b$12$first");
    setStoredPasswordHash(ctx.db, "$2b$12$second");

    expect(getStoredPasswordHash(ctx.db)).toBe("$2b$12$second");
    expect(ctx.db.select().from(appSettings).all()).toHaveLength(1);
  });
});
