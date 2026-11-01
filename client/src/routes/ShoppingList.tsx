import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MapPin, X } from "lucide-react";
import {
  DEFAULT_SHOP_RADIUS_M,
  LIST_NAME_MAX_LENGTH,
  MAX_SHOP_RADIUS_M,
  MIN_SHOP_RADIUS_M,
  type ListDTO,
} from "@logger/shared";
import { useDeleteList, useDeleteListItem, useList, useUpdateList } from "../api/hooks.js";
import { LocalValidationError } from "../local/localMutations.js";
import { useEditableRoute } from "../components/EditModeProvider.js";
import { ListItemInput } from "../components/ListItemInput.js";
import { useToast } from "../components/ToastProvider.js";
import {
  CARD_ACTION_CLASS,
  CARD_ACTION_DANGER_CLASS,
  CARD_CLASS,
  DANGER_BUTTON_CLASS,
  FIELD_CLASS,
  PRIMARY_BUTTON_SM_CLASS,
  SECONDARY_BUTTON_SM_CLASS,
} from "../components/ui.js";
import { MainBadge } from "./Shopping.js";

/**
 * The shop's geofence. It is tagged from the companion app while standing in the shop (a web
 * page can't read your location over the LAN's plain http); here it can be widened or cleared.
 */
function ShopLocationEditor({ list }: { list: ListDTO }) {
  const location = list.location;
  const [radius, setRadius] = useState(String(location?.radiusM ?? DEFAULT_SHOP_RADIUS_M));
  const [confirmingClear, setConfirmingClear] = useState(false);
  const updateList = useUpdateList(list.id);
  const { showToast } = useToast();

  if (!location) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Not tagged to a shop. In the Hub companion app, open Shops and tap "Tag with where I am
        now" while you're there, and your phone will offer this list when you arrive.
      </p>
    );
  }

  const radiusM = Number(radius);
  const radiusValid =
    Number.isInteger(radiusM) && radiusM >= MIN_SHOP_RADIUS_M && radiusM <= MAX_SHOP_RADIUS_M;

  async function handleRadius(e: FormEvent) {
    e.preventDefault();
    if (!location || !radiusValid || radiusM === location.radiusM) return;
    try {
      await updateList.mutateAsync({ location: { ...location, radiusM } });
      showToast(`Shop radius set to ${radiusM} m`);
    } catch {
      showToast("Could not change the radius");
    }
  }

  async function handleClear() {
    try {
      await updateList.mutateAsync({ location: null });
      showToast("Shop location cleared");
    } catch {
      setConfirmingClear(false);
      showToast("Could not clear the location");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleRadius} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600 dark:text-slate-300">Shop radius (metres)</span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_SHOP_RADIUS_M}
            max={MAX_SHOP_RADIUS_M}
            step={5}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            className={`w-32 ${FIELD_CLASS}`}
          />
        </label>
        <button
          type="submit"
          disabled={!radiusValid || radiusM === location.radiusM}
          className={PRIMARY_BUTTON_SM_CLASS}
        >
          Save radius
        </button>
      </form>
      {!radiusValid && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Between {MIN_SHOP_RADIUS_M} and {MAX_SHOP_RADIUS_M} metres.
        </p>
      )}
      {confirmingClear ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Stop watching for this shop?</span>
          <button type="button" onClick={handleClear} className={DANGER_BUTTON_CLASS}>
            Clear location
          </button>
          <button
            type="button"
            onClick={() => setConfirmingClear(false)}
            className={SECONDARY_BUTTON_SM_CLASS}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          className={`self-start ${CARD_ACTION_DANGER_CLASS}`}
        >
          Clear location
        </button>
      )}
    </div>
  );
}

/** Rename, make main and delete — the header pencil's controls. */
function ListEditor({ list }: { list: ListDTO }) {
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateList = useUpdateList(list.id);
  const deleteList = useDeleteList();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const reportError = (err: unknown, fallback: string) => {
    if (err instanceof LocalValidationError) setError(err.message);
    else showToast(fallback);
  };

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value || value === list.name) return;
    try {
      await updateList.mutateAsync({ name: value });
      showToast("List renamed");
    } catch (err) {
      reportError(err, "Could not rename the list");
    }
  }

  async function handleMakeMain() {
    try {
      await updateList.mutateAsync({ isDefault: true });
      showToast(`${list.name} is now the main list`);
    } catch (err) {
      reportError(err, "Could not change the main list");
    }
  }

  async function handleDelete() {
    try {
      await deleteList.mutateAsync(list.id);
      showToast("List deleted");
      navigate("/shopping");
    } catch (err) {
      setConfirmingDelete(false);
      reportError(err, "Could not delete the list");
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${CARD_CLASS}`}>
      <form onSubmit={handleRename} className="flex flex-col gap-2">
        <input
          type="text"
          aria-label="List name"
          value={name}
          maxLength={LIST_NAME_MAX_LENGTH}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className={`w-full ${FIELD_CLASS}`}
        />
        <button
          type="submit"
          disabled={!name.trim() || name.trim() === list.name}
          className={`self-start ${PRIMARY_BUTTON_SM_CLASS}`}
        >
          Save name
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <ShopLocationEditor list={list} />

      {list.isDefault ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This is the main list. Voice adds go here when no list is named, and it can't be
          deleted — make another list main first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleMakeMain} className={CARD_ACTION_CLASS}>
            Make main list
          </button>
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600 dark:text-slate-300">
                Delete this list{list.itemCount > 0 ? ` and its ${list.itemCount} items` : ""}?
              </span>
              <button type="button" onClick={handleDelete} className={DANGER_BUTTON_CLASS}>
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
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={CARD_ACTION_DANGER_CLASS}
            >
              Delete list
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ShoppingList() {
  const { id } = useParams<{ id: string }>();
  const listId = Number(id);
  const { data: list, isLoading, isError } = useList(listId);
  const deleteItem = useDeleteListItem();
  const editing = useEditableRoute();
  const { showToast } = useToast();

  if (isLoading) return <p className="text-slate-500 dark:text-slate-400">Loading…</p>;
  if (isError || !list) return <p className="text-slate-500 dark:text-slate-400">List not found.</p>;

  async function handleRemove(itemId: number) {
    try {
      await deleteItem.mutateAsync({ listId, itemId });
    } catch {
      showToast("Could not remove that item");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
        <span className="break-words">{list.name}</span>
        {list.isDefault && <MainBadge />}
      </h1>
      {list.location && (
        <p className="-mt-3 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <MapPin aria-hidden className="h-4 w-4" />
          Tagged to a shop · {list.location.radiusM} m
        </p>
      )}

      {/* Mounted only while editing, so each visit to edit mode starts from the current name. */}
      {editing && <ListEditor list={list} />}

      <ListItemInput listId={list.id} listName={list.name} />

      {list.items.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">Nothing on this list.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
          {list.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-1 pl-4 pr-1">
              <span className="min-w-0 flex-1 break-words dark:text-white">{item.text}</span>
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                onClick={() => handleRemove(item.id)}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              >
                <X aria-hidden className="h-6 w-6" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
