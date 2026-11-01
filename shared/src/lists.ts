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

/**
 * Where a shop is: the companion app tags it ("Tag with where I am now") and watches a geofence of
 * radiusM metres around it. 75 m was the user's choice; Android recommends 100 m or more, and
 * indoor GPS drifts 20–50 m, so it is adjustable per shop within these bounds.
 */
export interface ListLocation {
  latitude: number;
  longitude: number;
  radiusM: number;
}

export const DEFAULT_SHOP_RADIUS_M = 75;
export const MIN_SHOP_RADIUS_M = 25;
export const MAX_SHOP_RADIUS_M = 1000;

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
  /** Null until the shop is tagged from the companion app. */
  location: ListLocation | null;
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

/**
 * Rename, make main, move or clear the location — any combination. A list can't be un-made main;
 * make another one main instead. `location: null` clears it.
 */
export interface UpdateListRequest {
  name?: string;
  isDefault?: true;
  location?: ListLocation | null;
}

export interface CreateListItemRequest {
  text: string;
}
