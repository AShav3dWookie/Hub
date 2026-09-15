import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import { AppError, NotFoundError } from "../lib/errors.js";
import { pushEndpointSchema, pushSubscriptionSchema } from "../lib/validation.js";
import { createWebPushSender, generateVapidKeys, type PushSender } from "../lib/webPush.js";
import { getOrCreateVapidKeys } from "../services/pushKeysService.js";
import {
  removeSubscription,
  sendTestNotification,
  upsertSubscription,
} from "../services/pushSubscriptionsService.js";

export interface PushOptions {
  vapidPublicKey: string;
  sendPush: PushSender;
}

/**
 * Device registration for push notifications. The reminders themselves are sent by
 * `notificationScheduler`, not from a request.
 *
 * `push` is supplied by the entrypoint, which shares one sender with the scheduler. When omitted
 * (tests that don't care about push) the keys and a real sender are made on first use.
 */
export function createNotificationsRouter(db: AppDb, push?: PushOptions): Router {
  const router = Router();

  let resolved = push;
  const getPush = (): PushOptions => {
    if (!resolved) {
      const keys = getOrCreateVapidKeys(db, generateVapidKeys);
      resolved = {
        vapidPublicKey: keys.publicKey,
        sendPush: createWebPushSender(keys, config.vapidSubject),
      };
    }
    return resolved;
  };

  router.get("/vapid-public-key", (_req, res) => {
    res.json({ publicKey: getPush().vapidPublicKey });
  });

  router.post("/subscriptions", (req, res) => {
    const { endpoint, keys } = pushSubscriptionSchema.parse(req.body);
    upsertSubscription(db, {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      label: req.get("user-agent")?.slice(0, 200) ?? null,
    });
    res.status(201).json({ subscribed: true });
  });

  router.delete("/subscriptions", (req, res) => {
    const { endpoint } = pushEndpointSchema.parse(req.body);
    removeSubscription(db, endpoint);
    res.status(204).send();
  });

  router.post("/test", (req, res, next) => {
    let endpoint: string;
    try {
      ({ endpoint } = pushEndpointSchema.parse(req.body));
    } catch (err) {
      next(err);
      return;
    }
    sendTestNotification(db, endpoint, getPush().sendPush)
      .then((result) => {
        if (result === "gone") {
          throw new NotFoundError("This device's subscription has expired — turn notifications on again");
        }
        if (result === "failed") {
          throw new AppError(502, "The push service didn't accept the notification — try again in a moment");
        }
        res.status(204).send();
      })
      .catch(next);
  });

  return router;
}
