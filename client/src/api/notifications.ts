import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disablePush,
  enablePush,
  pushStatus,
  requestNotificationPermission,
  sendTestPush,
} from "../sw/push.js";

export { requestNotificationPermission };

const PUSH_STATUS_KEY = ["push-status"];

/**
 * This device's push status. Unlike the replica reads it can change behind the app's back — the
 * permission revoked in site settings, say — so it is re-read whenever it is looked at.
 */
export function usePushStatus() {
  return useQuery({ queryKey: PUSH_STATUS_KEY, queryFn: pushStatus, staleTime: 0 });
}

/**
 * Online-only and never queued, like the password change: a subscription means nothing until the
 * server has it. Each refreshes the status whether or not it succeeded.
 */
export function useEnablePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: enablePush,
    onSettled: () => queryClient.invalidateQueries({ queryKey: PUSH_STATUS_KEY }),
  });
}

export function useDisablePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disablePush,
    onSettled: () => queryClient.invalidateQueries({ queryKey: PUSH_STATUS_KEY }),
  });
}

export function useSendTestPush() {
  return useMutation({ mutationFn: sendTestPush });
}

export function useRefreshPushStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: PUSH_STATUS_KEY });
}
