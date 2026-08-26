import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LoggableCategory, PersonTagInput } from "@logger/shared";
import { CATEGORY_META, CATEGORY_FIELDS } from "@logger/shared";
import { useEntityAutocomplete, useCreateLog } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";
import { PeopleTagInput } from "../components/PeopleTagInput.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";
import { useToast } from "../components/ToastProvider.js";

export function LogAddForm({ category }: { category: LoggableCategory }) {
  const fields = CATEGORY_FIELDS[category];
  const [title, setTitle] = useState("");
  const debouncedTitle = useDebouncedValue(title, 300);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const currentYear = new Date().getFullYear();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState(() => String(currentYear));
  const [releaseYear, setReleaseYear] = useState("");
  const [author, setAuthor] = useState("");
  const [people, setPeople] = useState<PersonTagInput[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: suggestions } = useEntityAutocomplete(category, debouncedTitle);
  const createLog = useCreateLog();
  const navigate = useNavigate();
  const { showToast } = useToast();

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
    try {
      await createLog.mutateAsync(
        selectedEntityId
          ? {
              entityId: selectedEntityId,
              rating,
              date: logDate,
              notes: notes || null,
              people: fields.hasPeople ? people : [],
            }
          : {
              category,
              title: title.trim(),
              releaseYear: fields.hasReleaseYear && releaseYear.trim() ? Number(releaseYear) : null,
              author: fields.hasAuthor && author.trim() ? author.trim() : null,
              rating,
              date: logDate,
              notes: notes || null,
              people: fields.hasPeople ? people : [],
            },
      );
      navigate("/");
      showToast("Saved!");
    } catch {
      setError("Failed to save entry");
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
          className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
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
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
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
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Rating</span>
        <StarRating value={rating} onChange={setRating} />
      </div>

      {fields.dateGranularity === "year" ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{fields.dateLabel}</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{fields.dateLabel}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>
      )}

      {fields.hasPeople && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">People</span>
          <PeopleTagInput value={people} onChange={setPeople} />
        </div>
      )}

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
        disabled={createLog.isPending}
        className="min-h-[44px] rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
      >
        Save
      </button>
    </form>
  );
}

