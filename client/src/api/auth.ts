import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";
import { getMeta, setMeta, META_AUTH_STATUS } from "../local/db.js";
import {
  markSignedOut,
  bestEffort,
  SIGNED_OUT,
  SESSION_EXPIRED_EVENT,
  type AuthStatus,
} from "./session.js";

export type { AuthStatus };

/** A hung logout stops blocking the local sign-out after this long. */
const LOGOUT_TIMEOUT_MS = 5_000;

/**
 * Auth status is the one read that still prefers the network — but it falls back to the
 * last-known value so an offline launch of an installed PWA still resolves `ProtectedRoute`
 * instead of hanging. A successful check refreshes the cached copy.
 *
 * The fallback is only safe because a 401 from anywhere now overwrites the cached copy with
 * {@link SIGNED_OUT} (see `markSignedOut`). Otherwise a stale `authenticated: true` here is
 * self-perpetuating: the app renders, every request fails, and the read that would notice is
 * the one being answered from the stale copy.
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const status = await api.get<AuthStatus>("/auth/status");
    await setMeta(META_AUTH_STATUS, status);
    return status;
  } catch (err) {
    const cached = await getMeta<AuthStatus>(META_AUTH_STATUS);
    if (cached) return cached;
    throw err;
  }
}

export function useAuthStatus() {
  return useQuery({ queryKey: ["auth-status"], queryFn: fetchAuthStatus });
}

/**
 * Drop the app to signed-out the moment anything learns the session is gone.
 *
 * The query cache is written directly rather than invalidated: an invalidation triggers a
 * refetch, and the whole problem is that the network is not answering. Writing the value makes
 * `ProtectedRoute` redirect immediately, and `Login` overwrites it again on success.
 */
export function useSessionExpiry(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onExpired = () => queryClient.setQueryData(["auth-status"], SIGNED_OUT);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [queryClient]);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<AuthStatus>("/auth/login", { password }),
    onSuccess: (status) => {
      // The login response IS an AuthStatus and is authoritative (the session cookie is now
      // set). Write it straight into the cache so a ProtectedRoute the user navigates to as
      // soon as this resolves sees `authenticated: true` immediately. Invalidating instead
      // left a window where the in-flight refetch still returned the stale `false` and bounced
      // them back to /login.
      queryClient.setQueryData(["auth-status"], status);
      void setMeta(META_AUTH_STATUS, status);
    },
  });
}

/**
 * Online-only and never queued, like login: a password change has to reach the server to mean
 * anything, so it deliberately skips the outbox. Nothing in the query cache changes — the session
 * and `["auth-status"]` are unaffected by a successful change.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post("/auth/password", input),
  });
}

/**
 * Logging out is a local act first; telling the server is best-effort and time-boxed.
 *
 * This used to clear state in `onSuccess`, which meant the button did nothing at all in the one
 * situation people reach for it — when requests are already failing. Clearing unconditionally
 * (and without waiting on a request that may never settle) is what makes Log out a reliable way
 * back to the login screen.
 *
 * The server call still matters when it lands: `cookie-session` is stateless, so only the
 * response's `Set-Cookie` actually drops the cookie. A logout that never reached the server
 * leaves it in place, and the next successful `/auth/status` will say so.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => bestEffort(api.post("/auth/logout"), LOGOUT_TIMEOUT_MS),
    onSettled: async () => {
      await markSignedOut();
      queryClient.setQueryData(["auth-status"], SIGNED_OUT);
    },
  });
}
