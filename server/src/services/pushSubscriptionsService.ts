import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import type { PushPayload, PushSender, PushTarget } from "../lib/webPush.js";

/**
 * Devices that have turned notifications on, keyed by their push endpoint. Re-subscribing the
 * same device (the app re-posts its subscription on every launch) updates the row in place.
 */

export interface SubscriptionInput extends PushTarget {
  label?: string | null;
}

export type StoredSubscription = typeof pushSubscriptions.$inferSelect;

export function upsertSubscription(db: AppDb, input: SubscriptionInput): StoredSubscription {
  const values = {
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    label: input.label ?? null,
  };
  return db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: values.p256dh, auth: values.auth, label: values.label },
    })
    .returning()
    .get();
}

/** Forget a device. Removing one that is already gone is not an error. */
export function removeSubscription(db: AppDb, endpoint: string): void {
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
}

export function listSubscriptions(db: AppDb): StoredSubscription[] {
  return db.select().from(pushSubscriptions).orderBy(pushSubscriptions.id).all();
}

export function getSubscription(db: AppDb, endpoint: string): StoredSubscription {
  const row = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .get();
  if (!row) throw new NotFoundError("This device is not subscribed");
  return row;
}

/**
 * Send one payload to each device in parallel. A device the push service reports gone is deleted;
 * the rest get `last_success_at` stamped. Returns how many devices accepted it.
 */
export async function sendToDevices(
  db: AppDb,
  devices: readonly StoredSubscription[],
  payload: PushPayload,
  ttlSeconds: number,
  send: PushSender,
): Promise<number> {
  const results = await Promise.all(
    devices.map(async (device) => ({ device, result: await send(device, payload, { ttlSeconds }) })),
  );

  const delivered = results.filter((r) => r.result === "ok").map((r) => r.device.endpoint);
  const gone = results.filter((r) => r.result === "gone").map((r) => r.device.endpoint);

  if (gone.length > 0) {
    db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, gone)).run();
  }
  if (delivered.length > 0) {
    db.update(pushSubscriptions)
      .set({ lastSuccessAt: new Date().toISOString() })
      .where(inArray(pushSubscriptions.endpoint, delivered))
      .run();
  }
  return delivered.length;
}

export type TestNotificationResult = "ok" | "gone" | "failed";

/**
 * "Send test notification" from Settings: a notification to the one device asking. `gone` means
 * the push service no longer recognises it, and the row has been removed.
 */
export async function sendTestNotification(
  db: AppDb,
  endpoint: string,
  send: PushSender,
): Promise<TestNotificationResult> {
  const device = getSubscription(db, endpoint);
  const payload: PushPayload = {
    title: "Notifications are on",
    body: "You'll get reminders at 9pm the day before and 9am on the day.",
    url: "/settings",
    tag: "test",
  };
  if ((await sendToDevices(db, [device], payload, 60, send)) === 1) return "ok";
  return listSubscriptions(db).some((s) => s.endpoint === endpoint) ? "failed" : "gone";
}
