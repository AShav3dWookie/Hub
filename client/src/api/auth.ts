import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";

interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.get<AuthStatus>("/auth/status"),
  });
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
