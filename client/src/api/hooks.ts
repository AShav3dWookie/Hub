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

export function useSearch(query: SearchQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => api.get<SearchResponse>(`/search?${params.toString()}`),
    placeholderData: keepPreviousData,
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

