import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";
import { getMeta, setMeta, META_AUTH_STATUS } from "../local/db.js";

interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

/**
 * Auth status is the one read that still prefers the network — but it falls back to the
 * last-known value so an offline launch of an installed PWA still resolves `ProtectedRoute`
 * instead of hanging. A successful check refreshes the cached copy.
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

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<AuthStatus>("/auth/login", { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });
}
