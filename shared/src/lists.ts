/**
 * General-purpose lists. Shopping is the only kind so far; the `kind` column exists so a later
 * to-do list is another member of LIST_KINDS rather than a second pair of tables.
 *
 * Every kind has exactly one default ("main") list, which voice entry falls back to when no
 * list is named. List names are unique per kind and items unique per list, both compared via
 * `normalizeTitle`, so the offline client dedupes exactly as the server does.
 */
export const LIST_KINDS = ["shopping"] as const;

export type ListKind = (typeof LIST_KINDS)[number];

export const LIST_NAME_MAX_LENGTH = 80;
export const LIST_ITEM_MAX_LENGTH = 200;

export interface ListItemDTO {
  id: number;
  listId: number;
  text: string;
  createdAt: string;
}

/** A row on the lists screen. */
export interface ListSummaryDTO {
  id: number;
  kind: ListKind;
  name: string;
  isDefault: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListDTO extends ListSummaryDTO {
  /** Oldest first — the order they were added. */
  items: ListItemDTO[];
}

export interface CreateListRequest {
  kind?: ListKind;
  name: string;
}

/** Rename, make main, or both. A list can't be un-made main — make another one main instead. */
export interface UpdateListRequest {
  name?: string;
  isDefault?: true;
}

export interface CreateListItemRequest {
  text: string;
}
