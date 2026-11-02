import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { LIST_NAME_MAX_LENGTH, type ListSummaryDTO } from "@logger/shared";
import { useCreateList, useLists } from "../api/hooks.js";
import { LocalValidationError } from "../local/localMutations.js";
import { ListItemInput } from "../components/ListItemInput.js";
import { useToast } from "../components/ToastProvider.js";
import { useUnsavedChanges } from "../lib/unsavedChanges.js";
import {
  CARD_ACTION_CLASS,
  CARD_CLASS,
  FIELD_CLASS,
  ICON_BUTTON_ACTIVE_CLASS,
  ICON_BUTTON_CLASS,
  PRIMARY_BUTTON_SM_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "../components/ui.js";

export function itemCountLabel(count: number): string {
  if (count === 0) return "Empty";
  return `${count} item${count === 1 ? "" : "s"}`;
}

/** A small "Main" pill beside the default list's name. */
export function MainBadge() {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      Main
    </span>
  );
}

function ListRow({
  list,
  adding,
  onToggleAdd,
}: {
  list: ListSummaryDTO;
  adding: boolean;
  onToggleAdd: () => void;
}) {
  return (
    <li className={`flex flex-col gap-3 ${CARD_CLASS}`}>
      <div className="flex items-center gap-2">
        <Link
          to={`/shopping/${list.id}`}
          className="-mx-2 flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-md px-2 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <span className="flex items-center gap-2">
            <span className="truncate text-lg font-medium dark:text-white">{list.name}</span>
            {list.isDefault && <MainBadge />}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {itemCountLabel(list.itemCount)}
          </span>
        </Link>
        <button
          type="button"
          aria-label={`Add to ${list.name}`}
          aria-expanded={adding}
          onClick={onToggleAdd}
          className={`${ICON_BUTTON_CLASS} ${adding ? ICON_BUTTON_ACTIVE_CLASS : ""}`}
        >
          <Plus aria-hidden className="h-6 w-6" />
        </button>
      </div>
      {adding && (
        <ListItemInput listId={list.id} listName={list.name} autoFocus />
      )}
    </li>
  );
}

function NewListForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useUnsavedChanges(name.trim() !== "");
  const createList = useCreateList();
  const { showToast } = useToast();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    try {
      await createList.mutateAsync({ name: value });
      showToast(`Created ${value}`);
      onDone();
    } catch (err) {
      if (err instanceof LocalValidationError) setError(err.message);
      else showToast("Could not create the list");
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-2 ${CARD_CLASS}`}>
      <input
        type="text"
        aria-label="New list name"
        placeholder="e.g. Sainsbury's – Bangor"
        value={name}
        maxLength={LIST_NAME_MAX_LENGTH}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        autoFocus
        className={`w-full ${FIELD_CLASS}`}
      />
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={!name.trim()} className={PRIMARY_BUTTON_SM_CLASS}>
          Create list
        </button>
        <button type="button" onClick={onDone} className={SECONDARY_BUTTON_CLASS}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Every shopping list, each with a quick-add, so most adds never open a list at all. */
export function Shopping() {
  const { data, isLoading } = useLists("shopping");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Shopping</h1>

      {isLoading && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}

      <ul className="flex flex-col gap-2">
        {data?.map((list) => (
          <ListRow
            key={list.id}
            list={list}
            adding={addingTo === list.id}
            onToggleAdd={() => setAddingTo((open) => (open === list.id ? null : list.id))}
          />
        ))}
      </ul>

      {creating ? (
        <NewListForm onDone={() => setCreating(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={`gap-2 self-start ${CARD_ACTION_CLASS}`}
        >
          <Plus aria-hidden className="h-4 w-4" />
          New list
        </button>
      )}
    </div>
  );
}
