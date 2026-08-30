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
  SearchResponse,
  EntityWithLogsDTO,
  PersonProfileDTO,
  LogDTO,
  LogPhotoDTO,
  GalleryResponse,
  EntityNoteDTO,
  CreateEntityNoteRequest,
  UpdateEntityNoteRequest,
  UpcomingImportantDatesResponse,
  UpcomingEventsResponse,
  AlbumDTO,
  AlbumSummary,
  CreateAlbumRequest,
  UpdateAlbumRequest,
  PersonRef,
  PersonTagInput,
} from "@logger/shared";
import { api } from "./client.js";

interface AutocompleteResult {
  id: number;
  title: string;
  category: Category;
}

export function useEntityAutocomplete(category: Category, q: string) {
  return useQuery({
    queryKey: ["entity-autocomplete", category, q],
    queryFn: () =>
      api.get<AutocompleteResult[]>(
        `/entities/search?category=${category}&q=${encodeURIComponent(q)}`,
      ),
    enabled: q.trim().length > 0,
  });
}

export function usePersonAutocomplete(q: string) {
  return useEntityAutocomplete("person", q);
}

type EntityOrPersonDetail =
  | ({ type: "entity" } & EntityWithLogsDTO)
  | ({ type: "person" } & PersonProfileDTO);

export function useEntityDetail(id: number | undefined) {
  return useQuery({
    queryKey: ["entity", id],
    queryFn: () => api.get<EntityOrPersonDetail>(`/entities/${id}`),
    enabled: id != null,
  });
}

export function useSearch(query: SearchQuery, options: { enabled?: boolean } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => api.get<SearchResponse>(`/search?${params.toString()}`),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCreateEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntityRequest) => api.post("/entities", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entity-autocomplete"] });
    },
  });
}

export function useCreateLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLogRequest) => api.post<LogDTO>("/logs", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useUpdateLog(logId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLogRequest) => api.put<LogDTO>(`/logs/${logId}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      // editing a log's people changes who its photos are linked to
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useDeleteLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, deletePhotos }: { logId: number; deletePhotos: boolean }) =>
      api.delete(`/logs/${logId}${deletePhotos ? "?deletePhotos=true" : ""}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["gallery"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["gallery"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useDeleteLogPhoto(logId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/logs/${logId}/photos/${photoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["gallery"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useGallery() {
  return useInfiniteQuery({
    queryKey: ["gallery"],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      api.get<GalleryResponse>(`/gallery?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function usePersonPhotos(personId: number | undefined) {
  return useInfiniteQuery({
    queryKey: ["person-photos", personId],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      api.get<GalleryResponse>(
        `/entities/${personId}/photos?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: personId != null,
  });
}

export function useDeleteGalleryPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/gallery/${photoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gallery"] });
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

// ---- Albums ----

export function useAlbums() {
  return useQuery({
    queryKey: ["albums"],
    queryFn: () => api.get<AlbumSummary[]>("/albums"),
  });
}

export function useAlbum(id: number | undefined) {
  return useQuery({
    queryKey: ["album", id],
    queryFn: () => api.get<AlbumDTO>(`/albums/${id}`),
    enabled: id != null && Number.isInteger(id),
  });
}

export function useAlbumPhotos(id: number | undefined) {
  return useInfiniteQuery({
    queryKey: ["album-photos", id],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      api.get<GalleryResponse>(`/albums/${id}/photos?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: id != null && Number.isInteger(id),
  });
}

/** Invalidate everything an album change can ripple into. */
function invalidateAlbum(queryClient: ReturnType<typeof useQueryClient>, id: number) {
  queryClient.invalidateQueries({ queryKey: ["album", id] });
  queryClient.invalidateQueries({ queryKey: ["album-photos", id] });
  queryClient.invalidateQueries({ queryKey: ["albums"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
}

export function useCreateAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlbumRequest) => api.post<AlbumDTO>("/albums", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["entity"] });
    },
  });
}

export function useUpdateAlbum(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAlbumRequest) => api.put<AlbumDTO>(`/albums/${id}`, input),
    onSuccess: () => {
      invalidateAlbum(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["entity"] });
    },
  });
}

export function useDeleteAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deletePhotos }: { id: number; deletePhotos: boolean }) =>
      api.delete(`/albums/${id}${deletePhotos ? "?deletePhotos=true" : ""}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["album"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["gallery"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useAddAlbumEvent(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (logId: number) => api.post<AlbumDTO>(`/albums/${id}/events`, { logId }),
    onSuccess: () => {
      invalidateAlbum(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useRemoveAlbumEvent(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (logId: number) => api.delete(`/albums/${id}/events/${logId}`),
    onSuccess: () => {
      invalidateAlbum(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useAddAlbumPerson(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (person: PersonTagInput) => api.post<PersonRef[]>(`/albums/${id}/people`, person),
    onSuccess: () => {
      invalidateAlbum(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useRemoveAlbumPerson(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personId: number) => api.delete(`/albums/${id}/people/${personId}`),
    onSuccess: () => {
      invalidateAlbum(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
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
    onSuccess: () => {
      invalidateAlbum(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["gallery"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useDeleteAlbumPhoto(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/albums/${id}/photos/${photoId}`),
    onSuccess: () => {
      invalidateAlbum(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["gallery"] });
      queryClient.invalidateQueries({ queryKey: ["person-photos"] });
    },
  });
}

export function useEntityNotes(entityId: number | undefined) {
  return useQuery({
    queryKey: ["entity-notes", entityId],
    queryFn: () => api.get<EntityNoteDTO[]>(`/entities/${entityId}/notes`),
    enabled: entityId != null,
  });
}

export function useCreateEntityNote(entityId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntityNoteRequest) =>
      api.post<EntityNoteDTO>(`/entities/${entityId}/notes`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entity-notes", entityId] });
    },
  });
}

export function useUpdateEntityNote(entityId: number, noteId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEntityNoteRequest) =>
      api.put<EntityNoteDTO>(`/entities/${entityId}/notes/${noteId}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entity-notes", entityId] });
    },
  });
}

export function useDeleteEntityNote(entityId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: number) => api.delete(`/entities/${entityId}/notes/${noteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entity-notes", entityId] });
    },
  });
}

export function useUpcomingImportantDates() {
  return useQuery({
    queryKey: ["important-dates", "upcoming"],
    queryFn: () => api.get<UpcomingImportantDatesResponse>("/important-dates/upcoming"),
  });
}

export function useUpcomingEvents() {
  return useQuery({
    queryKey: ["events", "upcoming"],
    queryFn: () => api.get<UpcomingEventsResponse>("/events/upcoming"),
  });
}

