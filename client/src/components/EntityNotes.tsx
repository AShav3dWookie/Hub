import { useState } from "react";
import { FIELD_CLASS, PRIMARY_BUTTON_SM_CLASS, SECONDARY_BUTTON_CLASS, SECONDARY_BUTTON_SM_CLASS, DANGER_BUTTON_CLASS } from "./ui.js";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { EntityNoteDTO, NoteCategory } from "@logger/shared";
import { NOTE_CATEGORIES, NOTE_CATEGORY_META } from "@logger/shared";
import {
  useEntityNotes,
  useCreateEntityNote,
  useUpdateEntityNote,
  useDeleteEntityNote,
} from "../api/hooks.js";
import { useToast } from "./ToastProvider.js";

const CATEGORY_BADGE_STYLES: Record<NoteCategory, string> = {
  general: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  gift_idea: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  conversation_topic: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  important_date: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

function formatMonthDay(eventDate: string): string {
  const [, month, day] = eventDate.split("-").map(Number);
  return new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const EDITABLE_NOTE_CATEGORIES = NOTE_CATEGORIES.filter((c) => c !== "important_date");

function CategorySelect({
  value,
  onChange,
  categories = NOTE_CATEGORIES,
}: {
  value: NoteCategory;
  onChange: (category: NoteCategory) => void;
  categories?: readonly NoteCategory[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as NoteCategory)}
      className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
    >
      {categories.map((c) => (
        <option key={c} value={c}>
          {NOTE_CATEGORY_META[c].label}
        </option>
      ))}
    </select>
  );
}

function NoteRow({ note, entityId }: { note: EntityNoteDTO; entityId: number }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [category, setCategory] = useState<NoteCategory>(note.category);
  const [body, setBody] = useState(note.body);
  const [tag, setTag] = useState(note.tag ?? "");
  const [eventDate, setEventDate] = useState(note.eventDate ?? "");
  const isImportantDate = note.category === "important_date";

  const updateNote = useUpdateEntityNote(entityId, note.id);
  const deleteNote = useDeleteEntityNote(entityId);
  const { showToast } = useToast();

  async function handleSave() {
    if (isImportantDate) {
      if (!tag.trim() || !eventDate) return;
      await updateNote.mutateAsync({
        category,
        body: body.trim(),
        tag: tag.trim(),
        eventDate,
      });
    } else {
      if (!body.trim()) return;
      await updateNote.mutateAsync({ category, body: body.trim() });
    }
    setEditing(false);
    showToast("Note updated");
  }

  async function handleDelete() {
    await deleteNote.mutateAsync(note.id);
    showToast("Note deleted");
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        {isImportantDate ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="Tag (e.g. Birthday)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </div>
        ) : (
          <CategorySelect value={category} onChange={setCategory} categories={EDITABLE_NOTE_CATEGORIES} />
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isImportantDate ? "Optional notes" : undefined}
          rows={3}
          className={`mt-2 w-full ${FIELD_CLASS}`}
        />
        <div className="mt-2 flex gap-2">
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
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_BADGE_STYLES[note.category]}`}
        >
          {isImportantDate ? note.tag : NOTE_CATEGORY_META[note.category].label}
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {isImportantDate && note.eventDate ? formatMonthDay(note.eventDate) : note.createdAt.slice(0, 10)}
        </span>
      </div>
      {note.body && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
          {note.body}
        </p>
      )}
      {confirmingDelete ? (
        <div className="mt-2 flex items-center gap-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Delete this note?</span>
          <button
            type="button"
            onClick={handleDelete}
            className={DANGER_BUTTON_CLASS}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className={SECONDARY_BUTTON_SM_CLASS}
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
    </li>
  );
}

function NoteCategoryGroup({
  category,
  notes,
  entityId,
  expanded,
  onToggle,
}: {
  category: NoteCategory;
  notes: EntityNoteDTO[];
  entityId: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {NOTE_CATEGORY_META[category].label}
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{notes.length}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 p-3 dark:border-slate-800">
          {notes.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No notes in this category yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((note) => (
                <NoteRow key={note.id} note={note} entityId={entityId} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function EntityNotes({ entityId }: { entityId: number }) {
  const { data: notes, isLoading } = useEntityNotes(entityId);
  const [newCategory, setNewCategory] = useState<NoteCategory>("general");
  const [newBody, setNewBody] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<NoteCategory>>(new Set());

  const createNote = useCreateEntityNote(entityId);
  const { showToast } = useToast();
  const isImportantDate = newCategory === "important_date";

  function toggleCategory(category: NoteCategory) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (isImportantDate) {
      if (!newTag.trim() || !newEventDate) return;
      await createNote.mutateAsync({
        category: newCategory,
        body: newBody.trim(),
        tag: newTag.trim(),
        eventDate: newEventDate,
      });
      setNewTag("");
      setNewEventDate("");
    } else {
      if (!newBody.trim()) return;
      await createNote.mutateAsync({ category: newCategory, body: newBody.trim() });
    }
    setNewBody("");
    setNewCategory("general");
    showToast("Note added");
  }

  const notesByCategory: Record<NoteCategory, EntityNoteDTO[]> = {
    general: [],
    gift_idea: [],
    conversation_topic: [],
    important_date: [],
  };
  for (const note of notes ?? []) {
    notesByCategory[note.category].push(note);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Notes
      </h2>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
      >
        <CategorySelect value={newCategory} onChange={setNewCategory} />
        {isImportantDate && (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Tag (e.g. Birthday)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="date"
              value={newEventDate}
              onChange={(e) => setNewEventDate(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </div>
        )}
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder={
            isImportantDate
              ? "Optional notes (e.g. Don't forget the card!)"
              : "Conversation topics, gift ideas, anything to remember…"
          }
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={
            createNote.isPending || (isImportantDate ? !newTag.trim() || !newEventDate : !newBody.trim())
          }
          className="min-h-[44px] self-start rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-700"
        >
          Add note
        </button>
      </form>

      {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Loading notes…</p>}
      {!isLoading && (
        <div className="flex flex-col gap-2">
          {NOTE_CATEGORIES.map((category) => (
            <NoteCategoryGroup
              key={category}
              category={category}
              notes={notesByCategory[category]}
              entityId={entityId}
              expanded={expandedCategories.has(category)}
              onToggle={() => toggleCategory(category)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
