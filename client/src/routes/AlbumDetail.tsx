import { useRef, useState } from "react";
import { FIELD_CLASS, PRIMARY_BUTTON_SM_CLASS, SECONDARY_BUTTON_CLASS, SECONDARY_BUTTON_SM_CLASS, DANGER_BUTTON_CLASS } from "../components/ui.js";
import { useParams } from "react-router-dom";
import { MEDIA_ACCEPT_ATTR } from "@logger/shared";
import {
  useAlbum,
  useAlbumPhotos,
  useUpdateAlbum,
  useDeleteAlbum,
  useAddAlbumEvent,
  useRemoveAlbumEvent,
  useAddAlbumPerson,
  useRemoveAlbumPerson,
  useUploadAlbumPhotos,
  useDeleteAlbumPhoto,
} from "../api/hooks.js";
import { AlbumEventsSection, AlbumPeopleSection } from "../components/AlbumSections.js";
import { PhotoStream } from "../components/PhotoStream.js";
import { useToast } from "../components/ToastProvider.js";
import { useOnlineStatus } from "../api/localHooks.js";
import { updateDateRange } from "../lib/updateDateRange.js";

function dateRange(start: string | null, end: string | null): string | null {
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? null;
}

export function AlbumDetail() {
  const { id } = useParams<{ id: string }>();
  const albumId = Number(id);
  const { data: album, isLoading } = useAlbum(albumId);
  const photos = useAlbumPhotos(albumId);
  const { showToast } = useToast();
  const online = useOnlineStatus();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateAlbum = useUpdateAlbum(albumId);
  const deleteAlbum = useDeleteAlbum();
  const addEvent = useAddAlbumEvent(albumId);
  const removeEvent = useRemoveAlbumEvent(albumId);
  const addPerson = useAddAlbumPerson(albumId);
  const removePerson = useRemoveAlbumPerson(albumId);
  const uploadPhotos = useUploadAlbumPhotos(albumId);
  const deletePhoto = useDeleteAlbumPhoto(albumId);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");

  if (isLoading) return <p className="text-slate-500 dark:text-slate-400">Loading…</p>;
  if (!album) return <p className="text-slate-500 dark:text-slate-400">Not found.</p>;

  const photoPages = photos.data?.pages.flatMap((page) => page.photos) ?? [];
  const range = dateRange(album.dateStart, album.dateEnd);
  // Photos have no offline queue — need a connection and a real (synced) album id.
  const canEditPhotos = online && albumId > 0;

  function startEditing() {
    if (!album) return;
    setTitle(album.title);
    setNotes(album.notes ?? "");
    setDateStart(album.dateStart ?? "");
    setDateEnd(album.dateEnd ?? "");
    setEditing(true);
  }

  function applyRange(edited: "start" | "end", value: string) {
    const next = updateDateRange(edited, value, { start: dateStart, end: dateEnd });
    setDateStart(next.start);
    setDateEnd(next.end);
  }

  async function handleSave() {
    if (dateStart && dateEnd && dateEnd < dateStart) {
      showToast("End date must not be before the start date");
      return;
    }
    await updateAlbum.mutateAsync({
      title: title.trim(),
      notes: notes.trim() || null,
      dateStart: dateStart || null,
      dateEnd: dateEnd || null,
    });
    setEditing(false);
    showToast("Album updated");
  }

  async function handleDelete(deletePhotos: boolean) {
    try {
      await deleteAlbum.mutateAsync({ id: albumId, deletePhotos });
      showToast("Album deleted");
      window.history.back();
    } catch {
      setConfirmingDelete(false);
      showToast("Could not delete album");
    }
  }

  async function handleUpload(files: File[]) {
    if (files.length === 0) return;
    try {
      await uploadPhotos.mutateAsync(files);
      showToast("Photos added");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not upload photos");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      {editing ? (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-lg font-semibold dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <div className="flex gap-3">
            <input
              type="date"
              value={dateStart}
              onChange={(e) => applyRange("start", e.target.value)}
              className={`flex-1 ${FIELD_CLASS}`}
            />
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => applyRange("end", e.target.value)}
              className={`flex-1 ${FIELD_CLASS}`}
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Notes"
            className={FIELD_CLASS}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className={PRIMARY_BUTTON_SM_CLASS}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-semibold">{album.title}</h1>
          {range && <p className="text-slate-500 dark:text-slate-400">{range}</p>}
          {album.notes && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
              {album.notes}
            </p>
          )}
          <div className="mt-2 flex gap-1 text-sm">
            <button
              type="button"
              onClick={startEditing}
              className="min-h-[44px] rounded-md px-2 text-slate-600 hover:bg-slate-100 hover:underline dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="min-h-[44px] rounded-md px-2 text-red-600 hover:bg-red-50 hover:underline dark:text-red-400 dark:hover:bg-red-950"
            >
              Delete
            </button>
          </div>
          {confirmingDelete && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Delete this album?</span>
              {album.photoCount > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleDelete(true)}
                    className={DANGER_BUTTON_CLASS}
                  >
                    Delete album &amp; its loose photos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(false)}
                    className={SECONDARY_BUTTON_SM_CLASS}
                  >
                    Delete album, keep photos
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDelete(false)}
                  className={DANGER_BUTTON_CLASS}
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className={SECONDARY_BUTTON_SM_CLASS}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Photos — event photos + loose photos, aggregated, each shown once. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Photos
        </h2>
        {canEditPhotos ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={MEDIA_ACCEPT_ATTR}
              multiple
              onChange={(e) => handleUpload(Array.from(e.target.files ?? []))}
              className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-white dark:text-slate-300 dark:file:bg-slate-700"
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {albumId < 0
              ? "Photos can be added once this album has synced."
              : "Reconnect to add or remove photos."}
          </p>
        )}
        <PhotoStream
          photos={photoPages}
          isLoading={photos.isLoading}
          hasNextPage={Boolean(photos.hasNextPage)}
          isFetchingNextPage={photos.isFetchingNextPage}
          fetchNextPage={photos.fetchNextPage}
          emptyText="No photos yet — upload some, or link events that have photos."
          onDelete={
            canEditPhotos
              ? async (photoId) => {
                  try {
                    await deletePhoto.mutateAsync(photoId);
                    showToast("Photo deleted");
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : "Could not delete photo");
                  }
                }
              : undefined
          }
          canDelete={(photo) => photo.log == null}
        />
      </div>

      <AlbumPeopleSection
        people={album.people}
        directPersonIds={album.directPersonIds}
        onAdd={(person) => addPerson.mutateAsync(person)}
        onRemove={(personId) => removePerson.mutate(personId)}
      />

      <AlbumEventsSection
        events={album.events}
        onAdd={(logId) => addEvent.mutate(logId)}
        onRemove={(logId) => removeEvent.mutate(logId)}
      />
    </div>
  );
}
