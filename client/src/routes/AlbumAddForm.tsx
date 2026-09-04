import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type { LogWithEntityDTO, PersonTagInput } from "@logger/shared";
import { CATEGORY_META, MEDIA_ACCEPT_ATTR } from "@logger/shared";
import { useCreateAlbum, useUploadAlbumPhotosById } from "../api/hooks.js";
import { PeopleTagInput } from "../components/PeopleTagInput.js";
import { LogPicker } from "../components/LogPicker.js";
import { useToast } from "../components/ToastProvider.js";
import { useOnlineStatus } from "../api/localHooks.js";
import { updateDateRange } from "../lib/updateDateRange.js";
import { MAX_MEDIA_PER_LOG, rejectMediaSelection } from "../lib/mediaSelection.js";
import { resolveServerId } from "../sync/resolveServerId.js";

export function AlbumAddForm() {
  const [title, setTitle] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [people, setPeople] = useState<PersonTagInput[]>([]);
  const [events, setEvents] = useState<LogWithEntityDTO[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const createAlbum = useCreateAlbum();
  const uploadPhotos = useUploadAlbumPhotosById();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Media has no offline queue, and an album created offline has no real id to attach it to
  // until it syncs, so the picker is only offered when an upload could actually happen.
  const canPickMedia = online;

  function applyRange(edited: "start" | "end", value: string) {
    const next = updateDateRange(edited, value, { start: dateStart, end: dateEnd });
    setDateStart(next.start);
    setDateEnd(next.end);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (dateStart && dateEnd && dateEnd < dateStart) {
      setError("End date must not be before the start date");
      return;
    }

    const mediaProblem = rejectMediaSelection(photoFiles, { subject: "An album" });
    if (mediaProblem) {
      setError(mediaProblem);
      return;
    }

    let albumId: number;
    try {
      const created = await createAlbum.mutateAsync({
        title: title.trim(),
        notes: notes.trim() || null,
        dateStart: dateStart || null,
        dateEnd: dateEnd || null,
        people,
        eventLogIds: events.map((ev) => ev.id),
      });
      albumId = created.id;
    } catch {
      setError("Failed to create album");
      return;
    }

    let destinationId = albumId;
    let mediaFailed = false;
    if (photoFiles.length > 0) {
      try {
        destinationId = await resolveServerId(albumId);
        await uploadPhotos.mutateAsync({ albumId: destinationId, files: photoFiles });
      } catch {
        mediaFailed = true;
      }
    }

    navigate(`/album/${destinationId}`);
    if (mediaFailed) {
      showToast("Album created, but the photos didn't upload — add them from the album.");
    } else {
      showToast(online ? "Album created!" : "Album created — will sync when you're back online.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
      <h1 className="text-2xl font-semibold">Create an album</h1>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          autoFocus
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Start date</span>
          <input
            type="date"
            value={dateStart}
            onChange={(e) => applyRange("start", e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">End date</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => applyRange("end", e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">People</span>
        <PeopleTagInput value={people} onChange={setPeople} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Events</span>
        {events.length > 0 && (
          <ul className="flex flex-col gap-1">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
              >
                <span className="dark:text-white">
                  {ev.entity.title}{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    · {CATEGORY_META[ev.entity.category].label} · {ev.date}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${ev.entity.title}`}
                  onClick={() => setEvents((prev) => prev.filter((x) => x.id !== ev.id))}
                  className="flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <LogPicker
          excludeIds={events.map((ev) => ev.id)}
          onPick={(log) => setEvents((prev) => (prev.some((x) => x.id === log.id) ? prev : [...prev, log]))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Photos &amp; videos</span>
        <input
          type="file"
          accept={MEDIA_ACCEPT_ATTR}
          multiple
          disabled={!canPickMedia}
          onChange={(e) =>
            setPhotoFiles(Array.from(e.target.files ?? []).slice(0, MAX_MEDIA_PER_LOG))
          }
          className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-white disabled:opacity-50 dark:text-slate-300 dark:file:bg-slate-700"
        />
        {!canPickMedia && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Photos and videos need a connection. Create the album now and add them once
            you&rsquo;re back online.
          </p>
        )}
        {photoFiles.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {photoFiles.length} file{photoFiles.length === 1 ? "" : "s"} selected
          </p>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={createAlbum.isPending}
        className="min-h-[44px] rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
      >
        Create album
      </button>
    </form>
  );
}
