import { useState } from "react";
import type { PersonTagInput } from "@logger/shared";
import { usePersonAutocomplete } from "../api/hooks.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";
import { X } from "lucide-react";

interface Tag extends PersonTagInput {
  key: string;
  label: string;
}

export function PeopleTagInput({
  value,
  onChange,
}: {
  value: PersonTagInput[];
  onChange: (tags: PersonTagInput[]) => void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data: suggestions } = usePersonAutocomplete(debouncedQuery);

  const tags: Tag[] = value.map((tag, i) => ({
    ...tag,
    key: tag.id != null ? `id-${tag.id}` : `name-${tag.name}-${i}`,
    label: tag.name ?? "",
  }));

  function addTag(tag: PersonTagInput, label: string) {
    if (tags.some((t) => (t.id != null && t.id === tag.id) || (t.name && t.name === tag.name))) {
      setQuery("");
      return;
    }
    onChange([...value, { ...tag, name: tag.name ?? label }]);
    setQuery("");
  }

  function removeTag(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim()) {
      e.preventDefault();
      addTag({ name: query.trim() }, query.trim());
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-slate-700 dark:text-white"
          >
            {tag.name}
            <button
              type="button"
              onClick={() => removeTag(i)}
              aria-label={`Remove ${tag.name}`}
              className="flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full hover:bg-slate-300 dark:hover:bg-slate-600"
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a person (press Enter to create new)"
        className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
      />
      {suggestions && suggestions.length > 0 && query.trim() && (
        <ul className="mt-1 rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-slate-100 dark:text-white dark:hover:bg-slate-700"
                onClick={() => addTag({ id: s.id }, s.title)}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
