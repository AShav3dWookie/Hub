import { useEffect, useRef, useState } from "react";
import {
  CARD_ACTION_DANGER_CLASS,
  DANGER_BUTTON_CLASS,
  FIELD_CLASS,
  PRIMARY_BUTTON_SM_CLASS,
  SECONDARY_BUTTON_SM_CLASS,
} from "../components/ui.js";
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
import { useEditableRoute } from "../components/EditModeProvider.js";
import { useOnlineStatus } from "../api/localHooks.js";
import { updateDateRange } from "../lib/updateDateRange.js";

/** The album header form while it is being edited; null until something is typed. */
interface AlbumDraft {
  title: string;
  notes: string;
  dateStart: string;
  dateEnd: string;
}

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
  const editing = useEditableRoute();

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

  // The form is a draft laid over the album rather than a copy seeded from it: seeding runs
  // in an effect, which is one frame *after* the form first paints, and that frame showed an
  // empty title and blank dates. Null means "nothing typed yet", so the fields read straight
  // from the album and are right on the first render; a refetch landing mid-edit cannot
  // overwrite what has been typed either.
  const [draft, setDraft] = useState<AlbumDraft | null>(null);

  // Leaving edit mode discards the draft and any pending confirm — the header Done is the
  // cancel this form used to carry.
  useEffect(() => {
    if (!editing) {
      setDraft(null);
      setConfirmingDelete(false);
    }
  }, [editing]);

  if (isLoading) return <p className="text-slate-500 dark:text-slate-400">Loading…</p>;
  if (!album) return <p className="text-slate-500 dark:text-slate-400">Not found.</p>;

  const photoPages = photos.data?.pages.flatMap((page) => page.photos) ?? [];
  const range = dateRange(album.dateStart, album.dateEnd);
  const form: AlbumDraft = draft ?? {
    title: album.title,
    notes: album.notes ?? "",
    dateStart: album.dateStart ?? "",
    dateEnd: album.dateEnd ?? "",
  };
  const edit = (patch: Partial<AlbumDraft>) => setDraft({ ...form, ...patch });
  // Photos have no offline queue — need a connection and a real (synced) album id.
  const canEditPhotos = editing && online && albumId > 0;

  function applyRange(edited: "start" | "end", value: string) {
    const next = updateDateRange(edited, value, { start: form.dateStart, end: form.dateEnd });
    edit({ dateStart: next.start, dateEnd: next.end });
  }

  async function handleSave() {
    if (form.dateStart && form.dateEnd && form.dateEnd < form.dateStart) {
      showToast("End date must not be before the start date");
      return;
    }
    await updateAlbum.mutateAsync({
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      dateStart: form.dateStart || null,
      dateEnd: form.dateEnd || null,
    });
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
            aria-label="Album title"
            value={form.title}
            onChange={(e) => edit({ title: e.target.value })}
            className={`w-full text-lg font-semibold ${FIELD_CLASS}`}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="Start date"
              value={form.dateStart}
              onChange={(e) => applyRange("start", e.target.value)}
              className={`w-full ${FIELD_CLASS}`}
            />
            <input
              type="date"
              aria-label="End date"
              value={form.dateEnd}
              onChange={(e) => applyRange("end", e.target.value)}
              className={`w-full ${FIELD_CLASS}`}
            />
          </div>
          <textarea
            value={form.notes}
            onChange={(e) => edit({ notes: e.target.value })}
            rows={3}
            placeholder="Notes"
            className={`w-full ${FIELD_CLASS}`}
          />
          <button type="button" onClick={handleSave} className={`self-start ${PRIMARY_BUTTON_SM_CLASS}`}>
            Save
          </button>

          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
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
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={`self-start ${CARD_ACTION_DANGER_CLASS}`}
            >
              Delete album
            </button>
          )}
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
        </div>
      )}

      {/* Photos — event photos + loose photos, aggregated, each shown once. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Photos
        </h2>
        {editing &&
          (canEditPhotos ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept={MEDIA_ACCEPT_ATTR}
                multiple
                onChange={(e) => handleUpload(Array.from(e.target.files ?? []))}
                className="text-sm text-slate-600 file:mr-3 file:min-h-[44px] file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:text-white dark:text-slate-300 dark:file:bg-slate-700"
              />
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {albumId < 0
                ? "Photos can be added once this album has synced."
                : "Reconnect to add or remove photos."}
            </p>
          ))}
        <PhotoStream
          photos={photoPages}
          isLoading={photos.isLoading}
          hasNextPage={Boolean(photos.hasNextPage)}
          isFetchingNextPage={photos.isFetchingNextPage}
          fetchNextPage={photos.fetchNextPage}
          emptyText={
            editing
              ? "No photos yet — upload some, or link events that have photos."
              : "No photos yet."
          }
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
          currentAlbumId={albumId}
        />
      </div>

      <AlbumPeopleSection
        people={album.people}
        directPersonIds={album.directPersonIds}
        editing={editing}
        onAdd={(person) => addPerson.mutateAsync(person)}
        onRemove={(personId) => removePerson.mutate(personId)}
      />

      <AlbumEventsSection
        events={album.events}
        editing={editing}
        onAdd={(logId) => addEvent.mutate(logId)}
        onRemove={(logId) => removeEvent.mutate(logId)}
      />
    </div>
  );
}
