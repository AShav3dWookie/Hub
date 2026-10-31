/**
 * List ordering and assembly, shared by the server's `listService` and the offline client's
 * query layer. Both load the raw list and item rows their own way, then hand them here, so the
 * lists screen and a list's page can't come out in a different order on either side.
 */
import type { ListDTO, ListItemDTO, ListKind, ListSummaryDTO } from "../lists.js";

/** The stored fields of a list, as both the server row and the synced replica carry them. */
export interface ListRow {
  id: number;
  kind: ListKind;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The main list first, then by name (case-insensitive), then id. */
export function compareLists(a: ListRow, b: ListRow): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id - b.id;
}

/**
 * Oldest first — the order items were added, so a new one lands at the bottom. Creation times
 * are ISO strings stamped by application code on both sides, so they compare as text.
 */
export function compareListItems(a: ListItemDTO, b: ListItemDTO): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id - b.id;
}

function toSummary(list: ListRow, itemCount: number): ListSummaryDTO {
  return {
    id: list.id,
    kind: list.kind,
    name: list.name,
    isDefault: list.isDefault,
    itemCount,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

/** The lists screen: every list of `kind`, ordered, each with its item count. */
export function summariseLists(
  lists: readonly ListRow[],
  items: readonly Pick<ListItemDTO, "listId">[],
  kind: ListKind,
): ListSummaryDTO[] {
  const counts = new Map<number, number>();
  for (const item of items) counts.set(item.listId, (counts.get(item.listId) ?? 0) + 1);
  return lists
    .filter((l) => l.kind === kind)
    .sort(compareLists)
    .map((l) => toSummary(l, counts.get(l.id) ?? 0));
}

/** One list's page. `items` may hold other lists' items; only this list's are kept. */
export function assembleList(list: ListRow, items: readonly ListItemDTO[]): ListDTO {
  const own = items
    .filter((i) => i.listId === list.id)
    .map((i) => ({ id: i.id, listId: i.listId, text: i.text, createdAt: i.createdAt }))
    .sort(compareListItems);
  return { ...toSummary(list, own.length), items: own };
}
