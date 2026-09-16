import { ApiError, api } from "../api/client.js";

/**
 * Web Push on this device: whether it can be turned on, and turning it on and off.
 *
 * The server holds the subscriptions and does all the scheduling; this only obtains a
 * subscription from the browser and hands it over. Online-only — there is no queueing a
 * subscription, and nothing to show offline beyond the status.
 */

export type PushStatus =
  | "on" // subscribed, permission granted
  | "off" // could be turned on
  | "denied" // the user (or the browser) blocked notifications for this site
  | "needs-install" // iOS/iPadOS: push exists only for a Home Screen app
  | "insecure" // plain http (a LAN IP): the push APIs don't exist outside a secure context
  | "unsupported";

function isAppleMobile(): boolean {
  // iPadOS reports itself as a Mac; the touch points give it away.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!window.isSecureContext) return "insecure";
  if (isAppleMobile() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/**
 * Ask for permission. Call this straight from the click handler, before anything else is
 * awaited: Safari only shows the prompt while the tap still counts as a user gesture.
 */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

/** The VAPID public key arrives base64url-encoded; `subscribe` wants the raw bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!current || current.byteLength !== expected.byteLength) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((b, i) => b === expected[i]);
}

/**
 * Subscribe this device and register it with the server. Permission must already be granted.
 *
 * A subscription made against a different server key — the server's database was recreated, so
 * it generated a new pair — can never be delivered to, so it is replaced rather than re-sent.
 */
export async function enablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>("/notifications/vapid-public-key");
  const key = base64UrlToBytes(publicKey);

  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  await api.post("/notifications/subscriptions", subscription.toJSON());
}

/** Unsubscribe this device. The server is told first, but the browser unsubscribes regardless. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  try {
    await api.delete("/notifications/subscriptions", { endpoint: subscription.endpoint });
  } finally {
    await subscription.unsubscribe();
  }
}

/**
 * A 404 means the server has no such device — the push service reported it gone, or the row was
 * lost. The browser's copy is then useless too (re-sending it would only be refused again), so it is
 * dropped, which turns Settings back to "Turn on notifications" for a clean re-subscribe.
 */
export async function sendTestPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error("This device is not subscribed");
  try {
    await api.post("/notifications/test", { endpoint: subscription.endpoint });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) await subscription.unsubscribe();
    throw err;
  }
}

/**
 * On launch, re-register an existing subscription. The server upserts, so this is free when nothing
 * changed, and it restores a device the server forgot — a subscription the browser rotated while
 * the app was closed, or a recreated database, whose new key pair `enablePush` re-subscribes
 * against (no prompt: permission is already granted). Best-effort and silent.
 */
export async function refreshPushSubscription(): Promise<void> {
  try {
    if (!navigator.onLine || (await pushStatus()) !== "on") return;
    await enablePush();
  } catch {
    // Offline, signed out, or an older server: the next launch tries again.
  }
}
