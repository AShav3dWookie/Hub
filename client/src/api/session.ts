import { setMeta, META_AUTH_STATUS } from "../local/db.js";

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

/** What the app believes once it knows the session is gone. */
export const SIGNED_OUT: AuthStatus = { authRequired: true, authenticated: false };

/** Dispatched on `window` so the running app can react without a network round-trip. */
export const SESSION_EXPIRED_EVENT = "logger:session-expired";

/**
 * Record that this device's session is gone, and tell the running app.
 *
 * This is the correction for the cached `authenticated: true` that {@link ProtectedRoute} reads.
 * Without it a lost cookie was unrecoverable: the replica kept rendering a signed-in app, every
 * request 401'd, Settings said the server was unreachable, and nothing ever sent the user to
 * /login — while an incognito window, having no cached status, worked perfectly.
 *
 * The IndexedDB write is what persists the correction across a reload; the event is what makes
 * it immediate. Both are best-effort — a failure here must not take down the caller, which is
 * usually already handling an error.
 */
export async function markSignedOut(): Promise<void> {
  await setMeta(META_AUTH_STATUS, SIGNED_OUT).catch(() => undefined);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

/**
 * Await `promise`, but give up after `ms` and resolve anyway. Used for the logout request: the
 * person reaching for Log out is very often the one whose requests are already hanging, so the
 * local sign-out must not wait on the server to answer.
 */
export function bestEffort(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}
