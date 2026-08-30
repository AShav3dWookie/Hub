import { useState } from "react";
import { useParams, Navigate, Link } from "react-router-dom";
import type { PersonTagInput, LogDTO, LoggableCategory } from "@logger/shared";
import { CATEGORY_META, CATEGORY_FIELDS } from "@logger/shared";
import { useEntityDetail, useUpdateLog, useDeleteLog } from "../api/hooks.js";
import { formatLogDate } from "../lib/formatLogDate.js";
import { StarRating } from "../components/StarRating.js";
import { PeopleTagInput } from "../components/PeopleTagInput.js";
import { PhotoGallery } from "../components/PhotoGallery.js";
import { useToast } from "../components/ToastProvider.js";

export function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const entityId = Number(id);
  const { data, isLoading } = useEntityDetail(entityId);

  if (isLoading) return <p className="text-slate-500 dark:text-slate-400">Loading…</p>;
  if (!data) return <p className="text-slate-500 dark:text-slate-400">Not found.</p>;
  if (data.type === "person") return <Navigate to={`/person/${entityId}`} replace />;

  const fields = CATEGORY_FIELDS[data.category as LoggableCategory];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{data.title}</h1>
        <p className="text-slate-500 dark:text-slate-400">
          {CATEGORY_META[data.category].label}
          {fields.hasReleaseYear && data.releaseYear != null && ` · ${data.releaseYear}`}
          {fields.hasAuthor && data.author && ` · ${data.author}`}
          {" · "}
          {data.visitCount} log
          {data.visitCount === 1 ? "" : "s"}
          {data.averageRating != null && ` · avg ${data.averageRating.toFixed(1)}★`}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {data.logs.map((log) => (
          <LogRow key={log.id} log={log} fields={fields} category={data.category as LoggableCategory} />
        ))}
      </div>
    </div>
  );
}

function LogRow({
  log,
  fields,
  category,
}: {
  log: LogDTO;
  fields: (typeof CATEGORY_FIELDS)[LoggableCategory];
  category: LoggableCategory;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rating, setRating] = useState<number | null>(log.rating);
  const [date, setDate] = useState(log.date);
  const [year, setYear] = useState(log.date.slice(0, 4));
  const [notes, setNotes] = useState(log.notes ?? "");
  const [people, setPeople] = useState<PersonTagInput[]>(
    log.people.map((p) => ({ id: p.id, name: p.name })),
  );
  const [autoDelete, setAutoDelete] = useState(log.autoDelete);

  const updateLog = useUpdateLog(log.id);
  const deleteLog = useDeleteLog();
  const { showToast } = useToast();

  async function handleSave() {
    const nextDate = fields.dateGranularity === "year" ? `${year}-01-01` : date;
    await updateLog.mutateAsync({
      rating: fields.hasRating ? rating : null,
      date: nextDate,
      notes: notes || null,
      people: fields.hasPeople ? people : [],
      autoDelete: fields.hasAutoDelete ? autoDelete : false,
    });
    setEditing(false);
    showToast("Log updated");
  }

  async function handleDelete(deletePhotos: boolean) {
    try {
      await deleteLog.mutateAsync({ logId: log.id, deletePhotos });
      showToast("Log deleted");
    } catch {
      setConfirmingDelete(false);
      showToast("Could not delete log");
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        {fields.hasRating && <StarRating value={rating} onChange={setRating} />}
        {fields.dateGranularity === "year" ? (
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-2 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        ) : (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-2 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        )}
        {fields.hasPeople && (
          <div className="mt-2">
            <PeopleTagInput value={people} onChange={setPeople} />
          </div>
        )}
        {fields.hasPeople && (
          <PhotoGallery logId={log.id} photos={log.photos} allowDelete />
        )}
        {fields.hasAutoDelete && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoDelete}
              onChange={(e) => setAutoDelete(e.target.checked)}
            />
            Auto-delete once it's passed
          </label>
        )}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <div className="mt-2 flex gap-2">
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
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {formatLogDate(log.date, category)}
        </span>
        {fields.hasRating && <StarRating value={log.rating} readOnly />}
      </div>
      {fields.hasPeople && log.people.length > 0 && (
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
      {log.notes && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{log.notes}</p>}
      {log.albums.length > 0 && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          part of{" "}
          {log.albums.map((a, i) => (
            <span key={a.id}>
              <Link to={`/album/${a.id}`} className="hover:underline">
                {a.title}
              </Link>
              {i < log.albums.length - 1 ? ", " : ""}
            </span>
          ))}{" "}
          album{log.albums.length > 1 ? "s" : ""}
        </p>
      )}
      {fields.hasPeople && <PhotoGallery logId={log.id} photos={log.photos} />}
      {confirmingDelete ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Delete this log?</span>
          {log.photos.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => handleDelete(true)}
                className="min-h-[44px] rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete log &amp; {log.photos.length} photo{log.photos.length === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(false)}
                className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-200"
              >
                Delete log, keep photos
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
      ) : (
        <div className="mt-2 flex gap-1 text-sm">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-[44px] min-w-[44px] rounded-md px-2 text-slate-600 hover:bg-slate-100 hover:underline dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="min-h-[44px] min-w-[44px] rounded-md px-2 text-red-600 hover:bg-red-50 hover:underline dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

