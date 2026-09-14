import { and, eq, lt } from "drizzle-orm";
import {
  NOTIFICATION_SLOTS,
  itemsOccurringOn,
  summariseNotification,
  type NotificationItem,
  type NotificationSlotConfig,
} from "@logger/shared";
import type { AppDb } from "../db/client.js";
import { notificationDeliveries } from "../db/schema.js";
import { addDaysISO, localTime } from "../lib/localClock.js";
import type { PushSender } from "../lib/webPush.js";
import { selectImportantDateRows } from "./importantDatesService.js";
import { selectEventRows } from "./upcomingEventsService.js";
import { listSubscriptions, sendToDevices } from "./pushSubscriptionsService.js";

/**
 * Reminder notifications for upcoming dates: 9pm the evening before, 9am on the day, and 9am a
 * week before a birthday (`NOTIFICATION_SLOTS` in `@logger/shared`).
 *
 * The scheduler has no timetable of its own. Every tick asks "which slots are open right now?",
 * and sends whatever those slots cover that `notification_deliveries` says hasn't been announced.
 * That one rule covers the ordinary send, a restart that missed 9pm, and an item added at 10pm for
 * tomorrow alike, and a slot stops sending when it closes (midday / midnight).
 */

export const DELIVERY_RETENTION_DAYS = 30;

export interface TickOptions {
  timeZone: string;
  send: PushSender;
}

export interface TickResult {
  /** Notifications sent (one per group of slots), not devices reached. */
  notifications: number;
}

export async function runNotificationTick(
  db: AppDb,
  now: Date,
  { timeZone, send }: TickOptions,
): Promise<TickResult> {
  const { dateISO, minutes } = localTime(now, timeZone);

  db.delete(notificationDeliveries)
    .where(lt(notificationDeliveries.firedOn, addDaysISO(dateISO, -DELIVERY_RETENTION_DAYS)))
    .run();

  const open = NOTIFICATION_SLOTS.filter((s) => minutes >= s.startMinute && minutes < s.endMinute);
  if (open.length === 0) return { notifications: 0 };

  // Nobody to tell. Recording nothing means a device that subscribes later in the window still
  // gets this slot's reminder.
  const devices = listSubscriptions(db);
  if (devices.length === 0) return { notifications: 0 };

  const noteRows = selectImportantDateRows(db);
  const eventRows = selectEventRows(db);

  // Slots opening at the same minute share one notification (9am: Today + In a week).
  const groups = new Map<number, NotificationSlotConfig[]>();
  for (const slot of open) {
    groups.set(slot.startMinute, [...(groups.get(slot.startMinute) ?? []), slot]);
  }

  let notifications = 0;
  for (const slots of groups.values()) {
    const pending = slots.map((slot) => ({
      slot,
      items: unannounced(db, slot, dateISO, noteRows, eventRows),
    }));
    const message = summariseNotification(
      pending.map(({ slot, items }) => ({ heading: slot.heading, items })),
    );
    if (!message) continue;

    const endMinute = Math.min(...slots.map((s) => s.endMinute));
    const keys = pending.flatMap(({ slot, items }) => items.map((i) => `${slot.slot}/${i.key}`));
    const accepted = await sendToDevices(
      db,
      devices,
      { ...message, url: "/", tag: `${dateISO}/${keys.join(",")}` },
      // Expire with the slot: a phone that was off all morning shouldn't announce "Today" at 6pm.
      Math.max(60, (endMinute - minutes) * 60),
      send,
    );
    // Only a notification that reached at least one device counts as announced; otherwise the
    // next tick tries again, until the slot closes.
    if (accepted === 0) continue;

    const sentAt = now.toISOString();
    db.insert(notificationDeliveries)
      .values(
        pending.flatMap(({ slot, items }) =>
          items.map((item) => ({ slot: slot.slot, firedOn: dateISO, itemKey: item.key, sentAt })),
        ),
      )
      .onConflictDoNothing()
      .run();
    notifications++;
  }

  return { notifications };
}

function unannounced(
  db: AppDb,
  slot: NotificationSlotConfig,
  dateISO: string,
  noteRows: ReturnType<typeof selectImportantDateRows>,
  eventRows: ReturnType<typeof selectEventRows>,
): NotificationItem[] {
  const announced = new Set(
    db
      .select({ itemKey: notificationDeliveries.itemKey })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.slot, slot.slot), eq(notificationDeliveries.firedOn, dateISO)))
      .all()
      .map((r) => r.itemKey),
  );
  return itemsOccurringOn(noteRows, eventRows, addDaysISO(dateISO, slot.dayOffset), {
    birthdaysOnly: slot.birthdaysOnly,
  }).filter((item) => !announced.has(item.key));
}

export const TICK_INTERVAL_MS = 60_000;

/**
 * Tick now (catching up on anything a restart missed) and then once a minute. Called from the
 * entrypoint only — never from `createApp` — so tests never start a timer. Ticks never overlap:
 * a slow push service just delays the next one.
 */
export function startNotificationScheduler(db: AppDb, options: TickOptions): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runNotificationTick(db, new Date(), options)
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[notifications] tick failed:", err);
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  const timer = setInterval(tick, TICK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
