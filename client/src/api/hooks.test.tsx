import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const applyLocalMutation = vi.hoisted(() => vi.fn());
const refreshAfterMutation = vi.hoisted(() => vi.fn());
const getGallery = vi.hoisted(() => vi.fn());

vi.mock("../local/localMutations.js", () => ({ applyLocalMutation }));
vi.mock("./afterMutation.js", () => ({ refreshAfterMutation }));
vi.mock("../local/repo.js", () => ({ repo: { getGallery } }));

import {
  useAddAlbumEvent,
  useAddAlbumPerson,
  useAlbumPhotos,
  useCreateAlbum,
  useCreateEntity,
  useCreateEntityNote,
  useCreateLog,
  useDeleteAlbum,
  useDeleteEntityNote,
  useDeleteLog,
  useGallery,
  usePersonPhotos,
  useRemoveAlbumEvent,
  useRemoveAlbumPerson,
  useUpdateAlbum,
  useUpdateEntityNote,
  useUpdateLog,
  useUploadAlbumPhotos,
  useUploadLogPhotos,
} from "./hooks.js";
import { api } from "./client.js";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Run a mutation hook and return the envelope it queued. */
async function queued(hook: () => { mutateAsync: (args: never) => Promise<unknown> }, args: unknown) {
  const { result } = renderHook(hook, { wrapper: wrapper() });
  await result.current.mutateAsync(args as never);
  return applyLocalMutation.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  applyLocalMutation.mockReset().mockResolvedValue({ id: 1 });
  refreshAfterMutation.mockReset().mockResolvedValue(undefined);
  getGallery.mockReset().mockResolvedValue({ photos: [], nextCursor: null });
});

/**
 * Every write hook queues one outbox envelope and then refreshes. The envelope's shape is the
 * contract with the server's mutation dispatcher, so each hook is checked against the type and
 * payload it is supposed to produce.
 */
describe("write hooks queue the right envelope", () => {
  it("creates an entity", async () => {
    expect(await queued(useCreateEntity, { category: "movie", title: "Dune" })).toEqual({
      type: "entity.create",
      input: { category: "movie", title: "Dune" },
    });
  });

  it("creates a log", async () => {
    const input = { category: "movie", title: "Dune", rating: 5, date: "2026-01-01", notes: null, people: [] };
    expect(await queued(useCreateLog, input)).toEqual({ type: "log.create", input });
  });

  it("folds the log id into an update", async () => {
    const envelope = await queued(() => useUpdateLog(7), { rating: 3 });
    expect(envelope).toEqual({ type: "log.update", input: { rating: 3, logId: 7 } });
  });

  it("carries the keep-or-delete choice on a log delete", async () => {
    expect(await queued(useDeleteLog, { logId: 7, deletePhotos: true })).toEqual({
      type: "log.delete",
      input: { logId: 7, deletePhotos: true },
    });
  });

  it("creates an album", async () => {
    const input = { title: "Rome", notes: null, dateStart: null, dateEnd: null };
    expect(await queued(useCreateAlbum, input)).toEqual({ type: "album.create", input });
  });

  it("folds the album id into an update", async () => {
    const envelope = await queued(() => useUpdateAlbum(3), { title: "Rome trip" });
    expect(envelope).toEqual({ type: "album.update", input: { title: "Rome trip", albumId: 3 } });
  });

  it("renames the album id on a delete, matching the server payload", async () => {
    expect(await queued(useDeleteAlbum, { id: 3, deletePhotos: false })).toEqual({
      type: "album.delete",
      input: { albumId: 3, deletePhotos: false },
    });
  });

  it("links and unlinks an album event", async () => {
    expect(await queued(() => useAddAlbumEvent(3), 9)).toEqual({
      type: "album.addEvent",
      input: { albumId: 3, logId: 9 },
    });
    expect(await queued(() => useRemoveAlbumEvent(3), 9)).toEqual({
      type: "album.removeEvent",
      input: { albumId: 3, logId: 9 },
    });
  });

  it("adds and removes an album person", async () => {
    expect(await queued(() => useAddAlbumPerson(3), { name: "Ada" })).toEqual({
      type: "album.addPerson",
      input: { albumId: 3, person: { name: "Ada" } },
    });
    expect(await queued(() => useRemoveAlbumPerson(3), 5)).toEqual({
      type: "album.removePerson",
      input: { albumId: 3, personId: 5 },
    });
  });

  it("folds the entity id into a note create", async () => {
    const envelope = await queued(() => useCreateEntityNote(4), { category: "general", body: "hi" });
    expect(envelope).toEqual({
      type: "note.create",
      input: { category: "general", body: "hi", entityId: 4 },
    });
  });

  it("folds the note id into a note update", async () => {
    const envelope = await queued(() => useUpdateEntityNote(4, 11), { body: "edited" });
    expect(envelope).toEqual({ type: "note.update", input: { body: "edited", noteId: 11 } });
  });

  it("deletes a note by id alone", async () => {
    expect(await queued(() => useDeleteEntityNote(4), 11)).toEqual({
      type: "note.delete",
      input: { noteId: 11 },
    });
  });
});

describe("every write refreshes afterwards", () => {
  it("refreshes after a successful write", async () => {
    await queued(useCreateLog, {
      category: "movie",
      title: "Dune",
      rating: 5,
      date: "2026-01-01",
      notes: null,
      people: [],
    });
    expect(refreshAfterMutation).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the write itself failed", async () => {
    applyLocalMutation.mockRejectedValue(new Error("quota exceeded"));
    const { result } = renderHook(() => useCreateEntity(), { wrapper: wrapper() });

    await expect(
      result.current.mutateAsync({ category: "movie", title: "Dune" }),
    ).rejects.toThrow();
    expect(refreshAfterMutation).not.toHaveBeenCalled();
  });
});

describe("media hooks go to the server, not the outbox", () => {
  it("uploads log media as multipart under the photos field", async () => {
    const postForm = vi.spyOn(api, "postForm").mockResolvedValue([]);
    const { result } = renderHook(() => useUploadLogPhotos(7), { wrapper: wrapper() });

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await result.current.mutateAsync([file]);

    expect(postForm).toHaveBeenCalledWith("/logs/7/photos", expect.any(FormData));
    expect(applyLocalMutation).not.toHaveBeenCalled();
    const form = postForm.mock.calls[0][1] as FormData;
    expect(form.getAll("photos")).toHaveLength(1);
    postForm.mockRestore();
  });

  it("uploads album media to the album route", async () => {
    const postForm = vi.spyOn(api, "postForm").mockResolvedValue([]);
    const { result } = renderHook(() => useUploadAlbumPhotos(3), { wrapper: wrapper() });

    await result.current.mutateAsync([new File(["x"], "a.jpg", { type: "image/jpeg" })]);
    expect(postForm).toHaveBeenCalledWith("/albums/3/photos", expect.any(FormData));
    postForm.mockRestore();
  });

  it("appends every picked file", async () => {
    const postForm = vi.spyOn(api, "postForm").mockResolvedValue([]);
    const { result } = renderHook(() => useUploadLogPhotos(7), { wrapper: wrapper() });

    await result.current.mutateAsync([
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.mp4", { type: "video/mp4" }),
    ]);

    const form = postForm.mock.calls[0][1] as FormData;
    expect(form.getAll("photos")).toHaveLength(2);
    postForm.mockRestore();
  });
});

describe("paged photo streams", () => {
  it("asks for the whole gallery, unscoped", async () => {
    const { result } = renderHook(() => useGallery(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getGallery).toHaveBeenCalledWith({ cursor: undefined, limit: 50 });
  });

  it("scopes to a person", async () => {
    const { result } = renderHook(() => usePersonPhotos(5), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getGallery).toHaveBeenCalledWith({ personId: 5, cursor: undefined, limit: 50 });
  });

  it("scopes to an album", async () => {
    const { result } = renderHook(() => useAlbumPhotos(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getGallery).toHaveBeenCalledWith({ albumId: 3, cursor: undefined, limit: 50 });
  });

  it("stays idle until it has a person to scope to", () => {
    renderHook(() => usePersonPhotos(undefined), { wrapper: wrapper() });
    expect(getGallery).not.toHaveBeenCalled();
  });

  it("stays idle for an album id that is not a real number", () => {
    renderHook(() => useAlbumPhotos(Number.NaN), { wrapper: wrapper() });
    expect(getGallery).not.toHaveBeenCalled();
  });
});
