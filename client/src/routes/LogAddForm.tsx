import { useState } from "react";
import { FIELD_CLASS, PRIMARY_BUTTON_CLASS } from "../components/ui.js";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { LoggableCategory, PersonTagInput } from "@logger/shared";
import { CATEGORY_META, CATEGORY_FIELDS, MEDIA_ACCEPT_ATTR } from "@logger/shared";
import { useEntityAutocomplete, useCreateLog, useUploadLogPhotosById } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";
import { PeopleTagInput } from "../components/PeopleTagInput.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";
import { useToast } from "../components/ToastProvider.js";
import { useOnlineStatus } from "../api/localHooks.js";
import { MAX_MEDIA_PER_LOG, rejectMediaSelection } from "../lib/mediaSelection.js";
import { resolveServerId } from "../sync/resolveServerId.js";

export function LogAddForm({ category }: { category: LoggableCategory }) {
  const fields = CATEGORY_FIELDS[category];
  const online = useOnlineStatus();
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState("");
  const debouncedTitle = useDebouncedValue(title, 300);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const currentYear = new Date().getFullYear();
  // A calendar "add" shortcut passes ?date=YYYY-MM-DD to pre-fill day-granularity forms.
  const [date, setDate] = useState(() => {
    const d = searchParams.get("date");
    return fields.dateGranularity === "day" && d && /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? d
      : new Date().toISOString().slice(0, 10);
  });
  const [year, setYear] = useState(() => String(currentYear));
  const [releaseYear, setReleaseYear] = useState("");
  const [author, setAuthor] = useState("");
  const [people, setPeople] = useState<PersonTagInput[]>([]);
  const [autoDelete, setAutoDelete] = useState(true);
  const [notes, setNotes] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: suggestions } = useEntityAutocomplete(category, debouncedTitle);
  const createLog = useCreateLog();
  const uploadPhotos = useUploadLogPhotosById();
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Media goes straight to the server; there is no offline queue for it, and a record created
  // offline has no real id to attach it to until it syncs. So the picker is only offered when
  // an upload could actually happen.
  const canPickMedia = fields.hasPeople && online;

  // Where to go after saving — an in-app path from the calendar shortcut, else home.
  const returnParam = searchParams.get("returnTo");
  const returnTo =
    returnParam && returnParam.startsWith("/") && !returnParam.startsWith("//") ? returnParam : "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedEntityId && !title.trim()) {
      setError("Title is required");
      return;
    }
    if (fields.dateGranularity === "year" && !year.trim()) {
      setError("Year is required");
      return;
    }
    const logDate = fields.dateGranularity === "year" ? `${year.trim()}-01-01` : date;

    const mediaProblem = rejectMediaSelection(photoFiles);
    if (mediaProblem) {
      setError(mediaProblem);
      return;
    }

    let created;
    try {
      created = await createLog.mutateAsync(
        selectedEntityId
          ? {
              entityId: selectedEntityId,
              rating: fields.hasRating ? rating : null,
              date: logDate,
              notes: notes || null,
              people: fields.hasPeople ? people : [],
              autoDelete: fields.hasAutoDelete ? autoDelete : false,
            }
          : {
              category,
              title: title.trim(),
              releaseYear: fields.hasReleaseYear && releaseYear.trim() ? Number(releaseYear) : null,
              author: fields.hasAuthor && author.trim() ? author.trim() : null,
              rating: fields.hasRating ? rating : null,
              date: logDate,
              notes: notes || null,
              people: fields.hasPeople ? people : [],
              autoDelete: fields.hasAutoDelete ? autoDelete : false,
            },
      );
    } catch {
      setError("Failed to save entry");
      return;
    }

    let mediaFailed = false;
    if (photoFiles.length > 0) {
      try {
        const logId = await resolveServerId(created.id);
        await uploadPhotos.mutateAsync({ logId, files: photoFiles });
      } catch {
        mediaFailed = true;
      }
    }

    navigate(returnTo);
    if (mediaFailed) {
      showToast("Saved, but the photos didn't upload — add them from the entry.");
    } else {
      showToast(online ? "Saved!" : "Saved — will sync when you're back online.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
      <h1 className="text-2xl font-semibold">Log a {CATEGORY_META[category].label}</h1>

      <label className="flex flex-col gap-1 relative">
        <span className="text-sm font-medium">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSelectedEntityId(null);
          }}
          className={FIELD_CLASS}
          autoFocus
        />
        {suggestions && suggestions.length > 0 && !selectedEntityId && (
          <ul className="absolute top-full z-10 mt-16 w-full rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-slate-100 dark:text-white dark:hover:bg-slate-700"
                  onClick={() => {
                    setTitle(s.title);
                    setSelectedEntityId(s.id);
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </label>

      {fields.hasReleaseYear && !selectedEntityId && (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Release Year</span>
          <input
            type="number"
            value={releaseYear}
            onChange={(e) => setReleaseYear(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      )}

      {fields.hasAuthor && !selectedEntityId && (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Author</span>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      )}

      {fields.hasRating && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Rating</span>
          <StarRating value={rating} onChange={setRating} />
        </div>
      )}

      {fields.dateGranularity === "year" ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{fields.dateLabel}</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{fields.dateLabel}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      )}

      {fields.hasAutoDelete && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={autoDelete}
            onChange={(e) => setAutoDelete(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm">
            Auto-delete once it's passed
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Removed the day after — keep off to log it permanently.
            </span>
          </span>
        </label>
      )}

      {fields.hasPeople && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">People</span>
          <PeopleTagInput value={people} onChange={setPeople} />
        </div>
      )}

      {fields.hasPeople && (
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
              Photos and videos need a connection. Save now and add them from the entry once
              you&rsquo;re back online.
            </p>
          )}
          {photoFiles.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {photoFiles.length} file{photoFiles.length === 1 ? "" : "s"} selected
            </p>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className={FIELD_CLASS}
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={createLog.isPending}
        className={PRIMARY_BUTTON_CLASS}
      >
        Save
      </button>
    </form>
  );
}

