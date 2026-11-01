import crypto from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { deviceTokens } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import type { CreatedDeviceTokenDTO, DeviceTokenDTO } from "@logger/shared";

type Row = typeof deviceTokens.$inferSelect;

/** Recognisable in a config screen or a leaked log, and impossible to confuse with a password. */
const TOKEN_PREFIX = "hub_";

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function toDTO(r: Row): DeviceTokenDTO {
  return { id: r.id, name: r.name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt };
}

/** Mint a token for a named device. The returned `token` is the only copy that will ever exist. */
export function createDeviceToken(db: AppDb, name: string): CreatedDeviceTokenDTO {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const row = db
    .insert(deviceTokens)
    .values({ name: name.trim(), tokenHash: hashToken(token), createdAt: new Date().toISOString() })
    .returning()
    .get();
  return { ...toDTO(row), token };
}

export function listDeviceTokens(db: AppDb): DeviceTokenDTO[] {
  return db.select().from(deviceTokens).orderBy(asc(deviceTokens.id)).all().map(toDTO);
}

export function revokeDeviceToken(db: AppDb, id: number): void {
  const result = db.delete(deviceTokens).where(eq(deviceTokens.id, id)).run();
  if (result.changes === 0) throw new NotFoundError(`Device ${id} not found`);
}

/**
 * The device a presented token belongs to, or null. Stamps `last_used_at` at most once a minute,
 * so Settings can show which devices are live without a write on every request.
 */
export function authenticateDeviceToken(
  db: AppDb,
  token: string,
  now: Date = new Date(),
): DeviceTokenDTO | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = db.select().from(deviceTokens).where(eq(deviceTokens.tokenHash, hashToken(token))).get();
  if (!row) return null;

  const stale = !row.lastUsedAt || now.getTime() - Date.parse(row.lastUsedAt) > 60_000;
  if (stale) {
    const lastUsedAt = now.toISOString();
    db.update(deviceTokens).set({ lastUsedAt }).where(eq(deviceTokens.id, row.id)).run();
    return toDTO({ ...row, lastUsedAt });
  }
  return toDTO(row);
}
