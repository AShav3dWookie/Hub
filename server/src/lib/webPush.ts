import webpush from "web-push";

/**
 * The only file that talks to `web-push`. Everything else takes a `PushSender`, so the scheduler
 * and routes are tested with a fake and never reach a real push service.
 *
 * Delivery is outbound only: the payload is encrypted to the device's keys and POSTed to the push
 * service URL the browser handed out (FCM, Apple, Mozilla), which wakes the device. Nothing
 * inbound reaches the app, so the reverse proxy and its password page play no part.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the service worker's `push` handler receives and shows. */
export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification takes you. */
  url: string;
  /** Notifications sharing a tag replace each other on the device. */
  tag: string;
}

/**
 * - `ok` — the push service accepted it.
 * - `gone` — the subscription no longer exists (404/410: the app was uninstalled, permission was
 *   revoked, or the browser rotated it). The caller should forget it.
 * - `failed` — anything else; worth retrying later.
 */
export type PushSendResult = "ok" | "gone" | "failed";

export type PushSender = (
  target: PushTarget,
  payload: PushPayload,
  options: { ttlSeconds: number },
) => Promise<PushSendResult>;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

export function createWebPushSender(keys: VapidKeys, subject: string): PushSender {
  const vapidDetails = { subject, publicKey: keys.publicKey, privateKey: keys.privateKey };

  return async (target, payload, { ttlSeconds }) => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { vapidDetails, TTL: ttlSeconds, urgency: "high" },
      );
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      // eslint-disable-next-line no-console
      console.warn(`[push] send failed (${status ?? "network"}): ${(err as Error).message}`);
      return "failed";
    }
  };
}
