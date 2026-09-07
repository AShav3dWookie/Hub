import { useState } from "react";
import { FIELD_CLASS, REMOVE_BUTTON_CLASS } from "./ui.js";
import { normalizeTitle } from "@logger/shared";
import type { PersonTagInput } from "@logger/shared";
import { usePersonAutocomplete } from "../api/hooks.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";
import { Plus, X } from "lucide-react";

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

  const trimmed = query.trim();
  const alreadyTagged = tags.some((t) => normalizeTitle(t.label) === normalizeTitle(trimmed));
  const matchesSuggestion = (suggestions ?? []).some(
    (s) => normalizeTitle(s.title) === normalizeTitle(trimmed),
  );
  // There is no on-screen affordance for a brand-new name once this is false: the dropdown
  // used to render only for existing suggestions, so typing a novel name showed nothing —
  // no create row, no button — and Enter (unreliable on a touch keyboard, see below) was the
  // only way in.
  const canCreate = trimmed.length > 0 && !alreadyTagged && !matchesSuggestion;

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
    // Android soft keyboards deliver composed/autocorrected text as keyCode 229 with
    // key: "Unidentified" while an IME session is active, so the key check alone misses it —
    // and because this input sits inside a <form>, an unprevented Enter falls through as an
    // implicit submit. Bail before the key check so a mid-composition Enter neither creates a
    // tag nor saves the entry out from under whoever is still typing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key !== "Enter") return;
    // Always prevented, even with an empty query: LogAddForm and AlbumAddForm both submit and
    // navigate away on Enter otherwise, so Enter here must never reach the form.
    e.preventDefault();
    if (query.trim()) addTag({ name: query.trim() }, query.trim());
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
              className={REMOVE_BUTTON_CLASS}
            >
              <X size={14} aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a person"
        enterKeyHint="done"
        className={`w-full ${FIELD_CLASS}`}
      />
      {((suggestions && suggestions.length > 0) || canCreate) && (
        <ul className="mt-1 rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {suggestions?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center px-3 py-2 text-left hover:bg-slate-100 dark:text-white dark:hover:bg-slate-700"
                onClick={() => addTag({ id: s.id }, s.title)}
              >
                {s.title}
              </button>
            </li>
          ))}
          {canCreate && (
            <li>
              {/*
               * The tap path for a brand-new name — the fix for the mobile bug above. Calls
               * the same addTag the Enter handler calls, so creating never has two behaviours
               * to keep in sync.
               */}
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                onClick={() => addTag({ name: trimmed }, trimmed)}
              >
                <Plus size={16} aria-hidden />
                Create &ldquo;{trimmed}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
