import { useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { X } from "lucide-react";
import type { PersonTagInput } from "@logger/shared";
import { CATEGORY_META, MEDIA_ACCEPT_ATTR, categoryHasRating } from "@logger/shared";
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
import { StarRating } from "../components/StarRating.js";
import { PhotoStream } from "../components/PhotoStream.js";
import { PeopleTagInput } from "../components/PeopleTagInput.js";
import { LogPicker } from "../components/LogPicker.js";
import { useToast } from "../components/ToastProvider.js";
import { useOnlineStatus } from "../api/localHooks.js";
import { updateDateRange } from "../lib/updateDateRange.js";
import { formatLogDate } from "../lib/formatLogDate.js";

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
  const [personDraft, setPersonDraft] = useState<PersonTagInput[]>([]);

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

  async function handleAddPerson() {
    for (const tag of personDraft) {
      await addPerson.mutateAsync(tag.id != null ? { id: tag.id } : { name: tag.name });
    }
    setPersonDraft([]);
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
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => applyRange("end", e.target.value)}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Notes"
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="min-h-[44px] rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white dark:bg-slate-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-[44px] rounded-md border border-slate-300 px-4 py-1.5 text-sm dark:border-slate-600 dark:text-slate-200"
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
                    className="min-h-[44px] rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Delete album &amp; its loose photos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(false)}
                    className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-200"
                  >
                    Delete album, keep photos
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDelete(false)}
                  className="min-h-[44px] rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-200"
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

      {/* People — direct + pulled from linked events. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          People
        </h2>
        <div className="flex flex-wrap gap-2">
          {album.people.length === 0 && (
            <span className="text-sm text-slate-500 dark:text-slate-400">Nobody tagged yet.</span>
          )}
          {album.people.map((person) => {
            const direct = album.directPersonIds.includes(person.id);
            return (
              <span
                key={person.id}
                className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-slate-700 dark:text-white"
              >
                <Link to={`/person/${person.id}`} className="hover:underline">
                  {person.name}
                </Link>
                {direct ? (
                  <button
                    type="button"
                    aria-label={`Remove ${person.name}`}
                    onClick={() => removePerson.mutate(person.id)}
                    className="flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full hover:bg-slate-300 dark:hover:bg-slate-600"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">via event</span>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          <PeopleTagInput value={personDraft} onChange={setPersonDraft} />
          {personDraft.length > 0 && (
            <button
              type="button"
              onClick={handleAddPerson}
              className="min-h-[44px] self-start rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white dark:bg-slate-700"
            >
              Add to album
            </button>
          )}
        </div>
      </div>

      {/* Events */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Events
        </h2>
        {album.events.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No events linked yet.</p>
        )}
        <ul className="flex flex-col gap-2">
          {album.events.map((log) => (
            <li
              key={log.id}
              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <Link
                  to={`/entity/${log.entity.id}`}
                  className="font-medium hover:underline dark:text-white"
                >
                  {log.entity.title}
                </Link>
                <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  {CATEGORY_META[log.entity.category].label} ·{" "}
                  {formatLogDate(log.date, log.entity.category)}
                  <button
                    type="button"
                    aria-label={`Remove ${log.entity.title} from album`}
                    onClick={() => removeEvent.mutate(log.id)}
                    className="flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <X size={14} />
                  </button>
                </span>
              </div>
              {categoryHasRating(log.entity.category) && <StarRating value={log.rating} readOnly />}
              {log.people.length > 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  with{" "}
                  {log.people.map((p, i) => (
                    <span key={p.id}>
                      <Link to={`/person/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                      {i < log.people.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </p>
              )}
              {log.notes && (
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{log.notes}</p>
              )}
            </li>
          ))}
        </ul>
        <LogPicker
          excludeIds={album.events.map((e) => e.id)}
          onPick={(log) => addEvent.mutate(log.id)}
        />
      </div>
    </div>
  );
}
