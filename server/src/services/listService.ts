import { and, eq, ne } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { listItems, lists } from "../db/schema.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { assembleList, normalizeTitle, summariseLists } from "@logger/shared";
import type {
  CreateListItemRequest,
  CreateListRequest,
  ListDTO,
  ListItemDTO,
  ListKind,
  ListSummaryDTO,
  UpdateListRequest,
} from "@logger/shared";

type ListRowDb = typeof lists.$inferSelect;
type ItemRowDb = typeof listItems.$inferSelect;

const nowIso = () => new Date().toISOString();

function toItemDTO(r: ItemRowDb): ListItemDTO {
  return { id: r.id, listId: r.listId, text: r.text, createdAt: r.createdAt };
}

function getListRow(db: AppDb, id: number): ListRowDb {
  const row = db.select().from(lists).where(eq(lists.id, id)).get();
  if (!row) throw new NotFoundError(`List ${id} not found`);
  return row;
}

/** Another list of the same kind already uses this name. */
function assertNameFree(db: AppDb, kind: ListKind, normalizedName: string, exceptId?: number) {
  const clash = db
    .select({ id: lists.id })
    .from(lists)
    .where(
      and(
        eq(lists.kind, kind),
        eq(lists.normalizedName, normalizedName),
        exceptId != null ? ne(lists.id, exceptId) : undefined,
      ),
    )
    .get();
  if (clash) throw new BadRequestError("A list with that name already exists");
}

/** The lists screen. Personal-scale, so it loads the kind's items and counts them in memory. */
export function listLists(db: AppDb, kind: ListKind = "shopping"): ListSummaryDTO[] {
  const rows = db.select().from(lists).where(eq(lists.kind, kind)).all();
  const items = db
    .select({ listId: listItems.listId })
    .from(listItems)
    .innerJoin(lists, eq(listItems.listId, lists.id))
    .where(eq(lists.kind, kind))
    .all();
  return summariseLists(rows, items, kind);
}

export function getList(db: AppDb, id: number): ListDTO {
  const row = getListRow(db, id);
  const items = db.select().from(listItems).where(eq(listItems.listId, id)).all();
  return assembleList(row, items.map(toItemDTO));
}

export function createList(db: AppDb, input: CreateListRequest): ListDTO {
  const kind = input.kind ?? "shopping";
  const name = input.name.trim();
  const normalizedName = normalizeTitle(name);
  assertNameFree(db, kind, normalizedName);
  const now = nowIso();
  const row = db
    .insert(lists)
    .values({ kind, name, normalizedName, isDefault: false, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return assembleList(row, []);
}

/**
 * The offline replay of a create. Two devices can each create "Tesco" while offline; the
 * second one's create collapses into the first list, so items added on both end up together.
 */
export function findOrCreateList(db: AppDb, input: CreateListRequest): ListSummaryDTO {
  const kind = input.kind ?? "shopping";
  const existing = db
    .select()
    .from(lists)
    .where(and(eq(lists.kind, kind), eq(lists.normalizedName, normalizeTitle(input.name))))
    .get();
  return existing ? assembleList(existing, []) : createList(db, input);
}

/**
 * Rename and/or make main. Making a list main demotes the current one in the same transaction,
 * so the one-default-per-kind index never sees two.
 */
export function updateList(db: AppDb, id: number, input: UpdateListRequest): ListDTO {
  return db.transaction(() => {
    const existing = getListRow(db, id);
    const now = nowIso();
    const changes: Partial<ListRowDb> = { updatedAt: now };

    if (input.name != null) {
      const name = input.name.trim();
      const normalizedName = normalizeTitle(name);
      assertNameFree(db, existing.kind, normalizedName, id);
      changes.name = name;
      changes.normalizedName = normalizedName;
    }

    if (input.isDefault && !existing.isDefault) {
      db.update(lists)
        .set({ isDefault: false, updatedAt: now })
        .where(and(eq(lists.kind, existing.kind), eq(lists.isDefault, true)))
        .run();
      changes.isDefault = true;
    }

    db.update(lists).set(changes).where(eq(lists.id, id)).run();
    return getList(db, id);
  });
}

/** Deletes the list and, by cascade, its items. The main list can't be deleted. */
export function deleteList(db: AppDb, id: number): void {
  const existing = getListRow(db, id);
  if (existing.isDefault) {
    throw new BadRequestError("The main list can't be deleted — make another list main first");
  }
  db.delete(lists).where(eq(lists.id, id)).run();
}

/**
 * Add an item. A duplicate (same text ignoring case and spacing) is not an error — the list
 * already has it, so the existing item comes back and nothing is written.
 */
export function addListItem(db: AppDb, listId: number, input: CreateListItemRequest): ListItemDTO {
  getListRow(db, listId);
  const text = input.text.trim();
  const normalizedText = normalizeTitle(text);
  const existing = db
    .select()
    .from(listItems)
    .where(and(eq(listItems.listId, listId), eq(listItems.normalizedText, normalizedText)))
    .get();
  if (existing) return toItemDTO(existing);

  const now = nowIso();
  const row = db
    .insert(listItems)
    .values({ listId, text, normalizedText, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return toItemDTO(row);
}

export function deleteListItem(db: AppDb, listId: number, itemId: number): void {
  const existing = db
    .select({ id: listItems.id })
    .from(listItems)
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .get();
  if (!existing) throw new NotFoundError(`Item ${itemId} not found on list ${listId}`);
  db.delete(listItems).where(eq(listItems.id, itemId)).run();
}
