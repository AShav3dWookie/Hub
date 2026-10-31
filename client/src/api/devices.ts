import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatedDeviceTokenDTO, DeviceTokenDTO } from "@logger/shared";
import { api } from "./client.js";

const DEVICES_KEY = ["device-tokens"];

/**
 * Devices allowed to use the API with a token (the companion app). Server-only data — it is not
 * in the replica, and like the password and push settings it is never queued offline: a token
 * the server hasn't minted is no use to anyone.
 */
export function useDeviceTokens(enabled = true) {
  return useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => api.get<DeviceTokenDTO[]>("/device-tokens"),
    enabled,
  });
}

export function useCreateDeviceToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<CreatedDeviceTokenDTO>("/device-tokens", { name }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
  });
}

export function useRevokeDeviceToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/device-tokens/${id}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
  });
}
