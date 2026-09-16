import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { appSettings } from "../db/schema.js";
import type { VapidKeys } from "../lib/webPush.js";

/**
 * The server's VAPID key pair, which identifies it to push services. Generated once on first use
 * and kept in `app_settings`, on the same volume as the database, so there is no secret to put in
 * `.env`. Every device subscribes against the public key: replacing the pair would silently orphan
 * every existing subscription, which is why nothing here ever regenerates an existing one.
 */
const PUBLIC_KEY = "push.vapid_public_key";
const PRIVATE_KEY = "push.vapid_private_key";

export function getOrCreateVapidKeys(db: AppDb, generate: () => VapidKeys): VapidKeys {
  const rows = db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [PUBLIC_KEY, PRIVATE_KEY]))
    .all();
  const publicKey = rows.find((r) => r.key === PUBLIC_KEY)?.value;
  const privateKey = rows.find((r) => r.key === PRIVATE_KEY)?.value;
  if (publicKey && privateKey) return { publicKey, privateKey };

  const keys = generate();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.delete(appSettings).where(eq(appSettings.key, PUBLIC_KEY)).run();
    tx.delete(appSettings).where(eq(appSettings.key, PRIVATE_KEY)).run();
    tx.insert(appSettings)
      .values([
        { key: PUBLIC_KEY, value: keys.publicKey, updatedAt: now },
        { key: PRIVATE_KEY, value: keys.privateKey, updatedAt: now },
      ])
      .run();
  });
  return keys;
}
