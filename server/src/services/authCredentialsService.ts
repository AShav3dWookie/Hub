import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { appSettings } from "../db/schema.js";

/**
 * The stored login password.
 *
 * There is no row until the password is changed for the first time — before that the caller falls
 * back to the `AUTH_PASSWORD_HASH` env var. Once a row exists it is the only value that counts, so
 * a stale env hash left in `.env` after an in-app change is ignored rather than being a second
 * valid password. The env fallback deliberately lives in the route, not here: services take their
 * dependencies as arguments and never read `config`.
 */
const PASSWORD_HASH_KEY = "auth.password_hash";

export function getStoredPasswordHash(db: AppDb): string | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, PASSWORD_HASH_KEY)).get();
  return row?.value ?? null;
}

export function setStoredPasswordHash(db: AppDb, hash: string): void {
  const now = new Date().toISOString();
  db.insert(appSettings)
    .values({ key: PASSWORD_HASH_KEY, value: hash, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: hash, updatedAt: now } })
    .run();
}
