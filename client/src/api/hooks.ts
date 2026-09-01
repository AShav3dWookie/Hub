import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type {
  Category,
  CreateLogRequest,
  UpdateLogRequest,
  CreateEntityRequest,
  SearchQuery,
  LogPhotoDTO,
  CreateEntityNoteRequest,
  UpdateEntityNoteRequest,
  CreateAlbumRequest,
  UpdateAlbumRequest,
  PersonTagInput,
} from "@logger/shared";
import { api } from "./client.js";
import { repo } from "../local/repo.js";
import { applyLocalMutation } from "../local/localMutations.js";
import { refreshAfterMutation } from "./afterMutation.js";
import { gridRange } from "../lib/calendar.js";

/**
 * All data hooks. Reads resolve from the local IndexedDB replica via `repo` (never the
 * network). Writes are **local-first**: `applyLocalMutation` mutates the replica optimistically
 * and queues an envelope in the outbox; `refreshAfterMutation` then invalidates every query and
 * kicks a sync (which pushes the queue and pulls the server's answer back). Photo up/downloads
 * are the exception — they still go straight to the server (online-only for now).
 *
 * Query keys are unchanged so components/tests are untouched.
 */

export function useEntityAutocomplete(category: Category, q: string) {
  return useQuery({
    queryKey: ["entity-autocomplete", category, q],
    queryFn: () => repo.searchEntitiesByTitle(category, q),
    enabled: q.trim().length > 0,
  });
}

export function usePersonAutocomplete(q: string) {
  return useEntityAutocomplete("person", q);
}

export function useEntityDetail(id: number | undefined) {
  return useQuery({
    queryKey: ["entity", id],
    queryFn: () => repo.getEntityDetail(id as number),
    enabled: id != null,
  });
}

export function useSearch(query: SearchQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => repo.search(query),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCreateEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntityRequest) => applyLocalMutation({ type: "entity.create", input }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useCreateLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLogRequest) => applyLocalMutation({ type: "log.create", input }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useUpdateLog(logId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLogRequest) =>
      applyLocalMutation({ type: "log.update", input: { ...input, logId } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useDeleteLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, deletePhotos }: { logId: number; deletePhotos: boolean }) =>
      applyLocalMutation({ type: "log.delete", input: { logId, deletePhotos } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useUploadLogPhotos(logId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      const formData = new FormData();
      for (const file of files) formData.append("photos", file);
      return api.postForm<LogPhotoDTO[]>(`/logs/${logId}/photos`, formData);
    },
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useDeleteLogPhoto(logId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/logs/${logId}/photos/${photoId}`),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useGallery() {
  return useInfiniteQuery({
    queryKey: ["gallery"],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      repo.getGallery({ cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function usePersonPhotos(personId: number | undefined) {
  return useInfiniteQuery({
    queryKey: ["person-photos", personId],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      repo.getGallery({ personId, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: personId != null,
  });
}

export function useDeleteGalleryPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/gallery/${photoId}`),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

// ---- Albums ----

export function useAlbums() {
  return useQuery({
    queryKey: ["albums"],
    queryFn: () => repo.listAlbums(),
  });
}

export function useAlbum(id: number | undefined) {
  return useQuery({
    queryKey: ["album", id],
    queryFn: () => repo.getAlbum(id as number),
    enabled: id != null && Number.isInteger(id),
  });
}

export function useAlbumPhotos(id: number | undefined) {
  return useInfiniteQuery({
    queryKey: ["album-photos", id],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      repo.getGallery({ albumId: id, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: id != null && Number.isInteger(id),
  });
}

export function useCreateAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlbumRequest) => applyLocalMutation({ type: "album.create", input }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useUpdateAlbum(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAlbumRequest) =>
      applyLocalMutation({ type: "album.update", input: { ...input, albumId: id } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useDeleteAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deletePhotos }: { id: number; deletePhotos: boolean }) =>
      applyLocalMutation({ type: "album.delete", input: { albumId: id, deletePhotos } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useAddAlbumEvent(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (logId: number) =>
      applyLocalMutation({ type: "album.addEvent", input: { albumId: id, logId } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useRemoveAlbumEvent(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (logId: number) =>
      applyLocalMutation({ type: "album.removeEvent", input: { albumId: id, logId } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useAddAlbumPerson(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (person: PersonTagInput) =>
      applyLocalMutation({ type: "album.addPerson", input: { albumId: id, person } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useRemoveAlbumPerson(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personId: number) =>
      applyLocalMutation({ type: "album.removePerson", input: { albumId: id, personId } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useUploadAlbumPhotos(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      const formData = new FormData();
      for (const file of files) formData.append("photos", file);
      return api.postForm<LogPhotoDTO[]>(`/albums/${id}/photos`, formData);
    },
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useDeleteAlbumPhoto(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/albums/${id}/photos/${photoId}`),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useEntityNotes(entityId: number | undefined) {
  return useQuery({
    queryKey: ["entity-notes", entityId],
    queryFn: () => repo.listEntityNotes(entityId as number),
    enabled: entityId != null,
  });
}

export function useCreateEntityNote(entityId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntityNoteRequest) =>
      applyLocalMutation({ type: "note.create", input: { ...input, entityId } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useUpdateEntityNote(_entityId: number, noteId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEntityNoteRequest) =>
      applyLocalMutation({ type: "note.update", input: { ...input, noteId } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

export function useDeleteEntityNote(_entityId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: number) => applyLocalMutation({ type: "note.delete", input: { noteId } }),
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

/** The read-only calendar for a `YYYY-MM` month (fetches the whole visible grid range). */
export function useCalendarMonth(month: string) {
  const { from, to } = gridRange(month);
  return useQuery({
    queryKey: ["calendar", month],
    queryFn: () => repo.getCalendarRange(from, to),
    placeholderData: keepPreviousData,
  });
}

export function useUpcomingImportantDates() {
  return useQuery({
    queryKey: ["important-dates", "upcoming"],
    queryFn: () => repo.getUpcomingImportantDates(),
  });
}

export function useUpcomingEvents() {
  return useQuery({
    queryKey: ["events", "upcoming"],
    queryFn: () => repo.getUpcomingEvents(),
  });
}
