import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMeta,
  META_LAST_SYNC_AT,
  META_LAST_SYNC_ERROR,
} from "../local/db.js";
import { forceSync, nextScheduledSyncAt } from "../sync/engine.js";
import { deadLetters, discardDeadLetters, listOutbox } from "../local/outbox.js";
import type { OutboxRecord } from "../local/db.js";
import type { SyncErrorKind } from "../sync/pull.js";
import { thumbnailCacheStats, clearThumbnailCache } from "../sync/thumbnailCache.js";
import { periodicSyncStatus, type PeriodicSyncStatus } from "../sw/periodicSync.js";

/** Live `navigator.onLine`. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export interface SyncStatus {
  lastSyncAt: number | null;
  lastError: SyncErrorKind | null;
  nextScheduledAt: number | null;
}

export function useSyncStatus() {
  return useQuery<SyncStatus>({
    queryKey: ["sync-status"],
    queryFn: async () => ({
      lastSyncAt: (await getMeta<number>(META_LAST_SYNC_AT)) ?? null,
      lastError: (await getMeta<SyncErrorKind>(META_LAST_SYNC_ERROR)) ?? null,
      nextScheduledAt: await nextScheduledSyncAt(),
    }),
    refetchInterval: 30_000,
  });
}

export function useForceSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => forceSync(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      void queryClient.invalidateQueries({ queryKey: ["outbox"] });
      void queryClient.invalidateQueries();
    },
  });
}

export interface OutboxSummary {
  /** Envelopes still waiting to be pushed. */
  pending: number;
  /** Envelopes the server rejected — the user can only discard these. */
  dead: OutboxRecord[];
}

export function useOutbox() {
  return useQuery<OutboxSummary>({
    queryKey: ["outbox"],
    queryFn: async () => {
      const all = await listOutbox();
      return {
        pending: all.filter((r) => r.status === "pending").length,
        dead: await deadLetters(),
      };
    },
    refetchInterval: 10_000,
  });
}

export function useDiscardDeadLetters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discardDeadLetters(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["outbox"] });
      void queryClient.invalidateQueries();
    },
  });
}

export function usePeriodicSyncStatus() {
  return useQuery<PeriodicSyncStatus>({
    queryKey: ["periodic-sync-status"],
    queryFn: () => periodicSyncStatus(),
  });
}

export function useThumbnailCacheStats() {
  return useQuery({
    queryKey: ["thumb-cache"],
    queryFn: () => thumbnailCacheStats(),
  });
}

export function useClearThumbnailCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearThumbnailCache(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["thumb-cache"] }),
  });
}
