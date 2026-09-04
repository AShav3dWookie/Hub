import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { DEFAULT_GALLERY_LIMIT } from "@logger/shared";
import type {
  Category,
  CreateLogRequest,
  UpdateLogRequest,
  CreateEntityRequest,
  GalleryQuery,
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

/**
 * Every write in this file ends the same way: invalidate everything and kick a sync. Rather
 * than repeat that wiring in each hook, they all go through here.
 */
function useRefreshingMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => refreshAfterMutation(queryClient),
  });
}

/** The three photo streams differ only in what they are scoped to. */
function usePagedGallery(
  queryKey: unknown[],
  scope: Omit<GalleryQuery, "cursor" | "limit">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      repo.getGallery({ ...scope, cursor: pageParam, limit: DEFAULT_GALLERY_LIMIT }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** Photos and videos post as multipart, under the field name the upload routes expect. */
function uploadMedia(path: string, files: File[]) {
  const formData = new FormData();
  for (const file of files) formData.append("photos", file);
  return api.postForm<LogPhotoDTO[]>(path, formData);
}

// ---- Reads ----

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

export function useGallery() {
  return usePagedGallery(["gallery"], {});
}

export function usePersonPhotos(personId: number | undefined) {
  return usePagedGallery(["person-photos", personId], { personId }, personId != null);
}

export function useAlbumPhotos(id: number | undefined) {
  return usePagedGallery(
    ["album-photos", id],
    { albumId: id },
    id != null && Number.isInteger(id),
  );
}

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

export function useEntityNotes(entityId: number | undefined) {
  return useQuery({
    queryKey: ["entity-notes", entityId],
    queryFn: () => repo.listEntityNotes(entityId as number),
    enabled: entityId != null,
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

// ---- Writes: entities, logs and notes ----

export function useCreateEntity() {
  return useRefreshingMutation((input: CreateEntityRequest) =>
    applyLocalMutation({ type: "entity.create", input }),
  );
}

export function useCreateLog() {
  return useRefreshingMutation((input: CreateLogRequest) =>
    applyLocalMutation({ type: "log.create", input }),
  );
}

export function useUpdateLog(logId: number) {
  return useRefreshingMutation((input: UpdateLogRequest) =>
    applyLocalMutation({ type: "log.update", input: { ...input, logId } }),
  );
}

export function useDeleteLog() {
  return useRefreshingMutation(({ logId, deletePhotos }: { logId: number; deletePhotos: boolean }) =>
    applyLocalMutation({ type: "log.delete", input: { logId, deletePhotos } }),
  );
}

export function useCreateEntityNote(entityId: number) {
  return useRefreshingMutation((input: CreateEntityNoteRequest) =>
    applyLocalMutation({ type: "note.create", input: { ...input, entityId } }),
  );
}

export function useUpdateEntityNote(_entityId: number, noteId: number) {
  return useRefreshingMutation((input: UpdateEntityNoteRequest) =>
    applyLocalMutation({ type: "note.update", input: { ...input, noteId } }),
  );
}

export function useDeleteEntityNote(_entityId: number) {
  return useRefreshingMutation((noteId: number) =>
    applyLocalMutation({ type: "note.delete", input: { noteId } }),
  );
}

// ---- Writes: albums ----

export function useCreateAlbum() {
  return useRefreshingMutation((input: CreateAlbumRequest) =>
    applyLocalMutation({ type: "album.create", input }),
  );
}

export function useUpdateAlbum(id: number) {
  return useRefreshingMutation((input: UpdateAlbumRequest) =>
    applyLocalMutation({ type: "album.update", input: { ...input, albumId: id } }),
  );
}

export function useDeleteAlbum() {
  return useRefreshingMutation(({ id, deletePhotos }: { id: number; deletePhotos: boolean }) =>
    applyLocalMutation({ type: "album.delete", input: { albumId: id, deletePhotos } }),
  );
}

export function useAddAlbumEvent(id: number) {
  return useRefreshingMutation((logId: number) =>
    applyLocalMutation({ type: "album.addEvent", input: { albumId: id, logId } }),
  );
}

export function useRemoveAlbumEvent(id: number) {
  return useRefreshingMutation((logId: number) =>
    applyLocalMutation({ type: "album.removeEvent", input: { albumId: id, logId } }),
  );
}

export function useAddAlbumPerson(id: number) {
  return useRefreshingMutation((person: PersonTagInput) =>
    applyLocalMutation({ type: "album.addPerson", input: { albumId: id, person } }),
  );
}

export function useRemoveAlbumPerson(id: number) {
  return useRefreshingMutation((personId: number) =>
    applyLocalMutation({ type: "album.removePerson", input: { albumId: id, personId } }),
  );
}

// ---- Writes: media, which is online-only and bypasses the outbox ----

export function useUploadLogPhotos(logId: number) {
  return useRefreshingMutation((files: File[]) => uploadMedia(`/logs/${logId}/photos`, files));
}

export function useDeleteLogPhoto(logId: number) {
  return useRefreshingMutation((photoId: number) =>
    api.delete(`/logs/${logId}/photos/${photoId}`),
  );
}

export function useUploadAlbumPhotos(id: number) {
  return useRefreshingMutation((files: File[]) => uploadMedia(`/albums/${id}/photos`, files));
}

export function useDeleteAlbumPhoto(id: number) {
  return useRefreshingMutation((photoId: number) =>
    api.delete(`/albums/${id}/photos/${photoId}`),
  );
}

export function useDeleteGalleryPhoto() {
  return useRefreshingMutation((photoId: number) => api.delete(`/gallery/${photoId}`));
}
