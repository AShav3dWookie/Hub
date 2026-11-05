import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { deviceTokens } from "../db/schema.js";
import {
  authenticateDeviceToken,
  createDeviceToken,
  listDeviceTokens,
  revokeDeviceToken,
} from "./deviceTokensService.js";
import { NotFoundError } from "../lib/errors.js";

describe("deviceTokensService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("hands the token out once, and keeps only its hash", () => {
    ctx = createTestDb();
    const created = createDeviceToken(ctx.db, "  Pixel 6 ");

    expect(created.name).toBe("Pixel 6");
    expect(created.token).toMatch(/^hub_[A-Za-z0-9_-]{43}$/);
    expect(listDeviceTokens(ctx.db)).toEqual([
      { id: created.id, name: "Pixel 6", scope: "device", createdAt: created.createdAt, lastUsedAt: null },
    ]);
    const stored = ctx.db.select().from(deviceTokens).all();
    expect(JSON.stringify(stored)).not.toContain(created.token);
  });

  it("mints a different token every time", () => {
    ctx = createTestDb();
    expect(createDeviceToken(ctx.db, "A").token).not.toBe(createDeviceToken(ctx.db, "B").token);
  });

  it("recognises a valid token and nothing else", () => {
    ctx = createTestDb();
    const { token, id } = createDeviceToken(ctx.db, "Pixel 6");

    expect(authenticateDeviceToken(ctx.db, token)?.id).toBe(id);
    expect(authenticateDeviceToken(ctx.db, token + "x")).toBeNull();
    expect(authenticateDeviceToken(ctx.db, token.replace("hub_", ""))).toBeNull();
    expect(authenticateDeviceToken(ctx.db, "")).toBeNull();
  });

  it("stops recognising a token once it's revoked", () => {
    ctx = createTestDb();
    const { token, id } = createDeviceToken(ctx.db, "Pixel 6");
    revokeDeviceToken(ctx.db, id);

    expect(authenticateDeviceToken(ctx.db, token)).toBeNull();
    expect(listDeviceTokens(ctx.db)).toEqual([]);
    expect(() => revokeDeviceToken(ctx.db, id)).toThrow(NotFoundError);
  });

  it("records when a device was last used, at most once a minute", () => {
    ctx = createTestDb();
    const { token } = createDeviceToken(ctx.db, "Pixel 6");
    const at = (iso: string) => authenticateDeviceToken(ctx.db, token, new Date(iso));

    at("2026-10-31T10:00:00.000Z");
    at("2026-10-31T10:00:30.000Z");
    expect(listDeviceTokens(ctx.db)[0].lastUsedAt).toBe("2026-10-31T10:00:00.000Z");

    at("2026-10-31T10:01:30.000Z");
    expect(listDeviceTokens(ctx.db)[0].lastUsedAt).toBe("2026-10-31T10:01:30.000Z");
  });
});
