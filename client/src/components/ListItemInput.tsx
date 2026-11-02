import { useState, type FormEvent } from "react";
import { LIST_ITEM_MAX_LENGTH } from "@logger/shared";
import { useAddListItem } from "../api/hooks.js";
import { useToast } from "./ToastProvider.js";
import { FIELD_CLASS, PRIMARY_BUTTON_SM_CLASS } from "./ui.js";
import { useUnsavedChanges } from "../lib/unsavedChanges.js";

/**
 * The one-line "add an item" field, on a list's page and under a row on the lists screen.
 *
 * It clears but keeps focus after each add, so a run of items is type, Enter, type, Enter —
 * not a tap back into the field every time. A duplicate is silently absorbed by the write
 * layer, the same as on the server.
 */
export function ListItemInput({
  listId,
  listName,
  autoFocus = false,
}: {
  listId: number;
  listName: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  useUnsavedChanges(text.trim() !== "");
  const addItem = useAddListItem();
  const { showToast } = useToast();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    try {
      await addItem.mutateAsync({ listId, text: value });
    } catch {
      setText(value);
      showToast("Could not add that item");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        aria-label={`Add an item to ${listName}`}
        placeholder="Add an item…"
        value={text}
        maxLength={LIST_ITEM_MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
        enterKeyHint="done"
        autoFocus={autoFocus}
        className={`min-w-0 flex-1 ${FIELD_CLASS}`}
      />
      <button type="submit" disabled={!text.trim()} className={PRIMARY_BUTTON_SM_CLASS}>
        Add
      </button>
    </form>
  );
}
