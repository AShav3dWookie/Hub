import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LoggableCategory, PersonTagInput } from "@logger/shared";
import { CATEGORY_META } from "@logger/shared";
import { useEntityAutocomplete, useCreateLog } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";
import { PeopleTagInput } from "../components/PeopleTagInput.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";
import { useToast } from "../components/ToastProvider.js";

export function LogAddForm({ category }: { category: LoggableCategory }) {
  const [title, setTitle] = useState("");
  const debouncedTitle = useDebouncedValue(title, 300);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
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
    try {
      await createLog.mutateAsync(
        selectedEntityId
          ? { entityId: selectedEntityId, rating, date, notes: notes || null, people }
          : { category, title: title.trim(), rating, date, notes: notes || null, people },
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

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Rating</span>
        <StarRating value={rating} onChange={setRating} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Date</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">People</span>
        <PeopleTagInput value={people} onChange={setPeople} />
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
        disabled={createLog.isPending}
        className="min-h-[44px] rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
      >
        Save
      </button>
    </form>
  );
}
