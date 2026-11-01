import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import {
  listLists,
  getList,
  createList,
  findOrCreateList,
  updateList,
  deleteList,
  addListItem,
  deleteListItem,
  setListLocation,
} from "./listService.js";
import { getChanges } from "./syncService.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

describe("listService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  const mainList = () => listLists(ctx.db).find((l) => l.isDefault)!;

  it("starts with one main shopping list", () => {
    ctx = createTestDb();
    expect(listLists(ctx.db)).toEqual([
      expect.objectContaining({ name: "Shopping", kind: "shopping", isDefault: true, itemCount: 0 }),
    ]);
  });

  it("orders the main list first, then the rest by name, with item counts", () => {
    ctx = createTestDb();
    const tesco = createList(ctx.db, { name: "Tesco" });
    const aldi = createList(ctx.db, { name: "aldi" });
    addListItem(ctx.db, tesco.id, { text: "Eggs" });
    addListItem(ctx.db, tesco.id, { text: "Milk" });

    expect(listLists(ctx.db).map((l) => [l.name, l.itemCount])).toEqual([
      ["Shopping", 0],
      ["aldi", 0],
      ["Tesco", 2],
    ]);
    expect(aldi.isDefault).toBe(false);
  });

  it("refuses a second list with the same name, ignoring case and spacing", () => {
    ctx = createTestDb();
    createList(ctx.db, { name: "M&S  Bangor" });
    expect(() => createList(ctx.db, { name: "m&s bangor" })).toThrow(BadRequestError);
  });

  it("find-or-create collapses onto an existing list of the same name", () => {
    ctx = createTestDb();
    const tesco = createList(ctx.db, { name: "Tesco" });
    expect(findOrCreateList(ctx.db, { name: " tesco " }).id).toBe(tesco.id);
    expect(listLists(ctx.db)).toHaveLength(2);
  });

  it("renames a list, but not onto another list's name", () => {
    ctx = createTestDb();
    const tesco = createList(ctx.db, { name: "Tesco" });
    createList(ctx.db, { name: "Aldi" });

    expect(updateList(ctx.db, tesco.id, { name: "Tesco Bangor" }).name).toBe("Tesco Bangor");
    expect(() => updateList(ctx.db, tesco.id, { name: "aldi" })).toThrow(BadRequestError);
    // Renaming to its own name in a different case is fine.
    expect(updateList(ctx.db, tesco.id, { name: "TESCO BANGOR" }).name).toBe("TESCO BANGOR");
  });

  it("making a list main demotes the old main list", () => {
    ctx = createTestDb();
    const original = mainList();
    const tesco = createList(ctx.db, { name: "Tesco" });

    updateList(ctx.db, tesco.id, { isDefault: true });

    expect(mainList().id).toBe(tesco.id);
    expect(getList(ctx.db, original.id).isDefault).toBe(false);
    expect(listLists(ctx.db).filter((l) => l.isDefault)).toHaveLength(1);
  });

  it("won't delete the main list", () => {
    ctx = createTestDb();
    expect(() => deleteList(ctx.db, mainList().id)).toThrow(BadRequestError);
  });

  it("deleting a list deletes its items", () => {
    ctx = createTestDb();
    const tesco = createList(ctx.db, { name: "Tesco" });
    const eggs = addListItem(ctx.db, tesco.id, { text: "Eggs" });

    deleteList(ctx.db, tesco.id);

    expect(() => getList(ctx.db, tesco.id)).toThrow(NotFoundError);
    const { deletions } = getChanges(ctx.db);
    expect(deletions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: "list", id: tesco.id }),
        expect.objectContaining({ entityType: "list_item", id: eggs.id }),
      ]),
    );
  });

  it("keeps items in the order they were added", () => {
    ctx = createTestDb();
    const id = mainList().id;
    for (const text of ["Milk", "Eggs", "Bread"]) addListItem(ctx.db, id, { text });

    expect(getList(ctx.db, id).items.map((i) => i.text)).toEqual(["Milk", "Eggs", "Bread"]);
  });

  it("ignores a duplicate item, returning the one already there", () => {
    ctx = createTestDb();
    const id = mainList().id;
    const eggs = addListItem(ctx.db, id, { text: "Eggs" });

    expect(addListItem(ctx.db, id, { text: "  eggs " })).toEqual(eggs);
    expect(getList(ctx.db, id).items).toHaveLength(1);
  });

  it("allows the same item on two different lists", () => {
    ctx = createTestDb();
    const tesco = createList(ctx.db, { name: "Tesco" });
    addListItem(ctx.db, mainList().id, { text: "Eggs" });
    addListItem(ctx.db, tesco.id, { text: "Eggs" });

    expect(getList(ctx.db, tesco.id).items).toHaveLength(1);
  });

  it("removes an item, and 404s on one that isn't on that list", () => {
    ctx = createTestDb();
    const tesco = createList(ctx.db, { name: "Tesco" });
    const eggs = addListItem(ctx.db, tesco.id, { text: "Eggs" });

    expect(() => deleteListItem(ctx.db, mainList().id, eggs.id)).toThrow(NotFoundError);
    deleteListItem(ctx.db, tesco.id, eggs.id);
    expect(getList(ctx.db, tesco.id).items).toEqual([]);
    expect(() => deleteListItem(ctx.db, tesco.id, eggs.id)).toThrow(NotFoundError);
  });

  it("adding to a missing list is a 404", () => {
    ctx = createTestDb();
    expect(() => addListItem(ctx.db, 999, { text: "Eggs" })).toThrow(NotFoundError);
  });

  it("publishes lists and items on the change feed", () => {
    ctx = createTestDb();
    const tesco = createList(ctx.db, { name: "Tesco" });
    addListItem(ctx.db, tesco.id, { text: "Eggs" });

    const { changes } = getChanges(ctx.db);
    expect(changes.lists.map((l) => l.name)).toEqual(["Shopping", "Tesco"]);
    expect(changes.listItems).toEqual([
      expect.objectContaining({ listId: tesco.id, text: "Eggs", normalizedText: "eggs" }),
    ]);
  });

  describe("a shop's location", () => {
    const shop = { latitude: 53.2274, longitude: -4.1293, radiusM: 75 };

    it("is set, changed and cleared, and the other fields are left alone", () => {
      ctx = createTestDb();
      const tesco = createList(ctx.db, { name: "Tesco" });
      expect(tesco.location).toBeNull();

      expect(setListLocation(ctx.db, tesco.id, shop).location).toEqual(shop);
      expect(updateList(ctx.db, tesco.id, { location: { ...shop, radiusM: 150 } }).location?.radiusM).toBe(150);
      expect(updateList(ctx.db, tesco.id, { name: "Tesco Bangor" }).location?.radiusM).toBe(150);
      expect(setListLocation(ctx.db, tesco.id, null).location).toBeNull();
      expect(getList(ctx.db, tesco.id).name).toBe("Tesco Bangor");
    });

    it("reaches the change feed, so the PWA and the offline copy see a tag", () => {
      ctx = createTestDb();
      const tesco = createList(ctx.db, { name: "Tesco" });
      setListLocation(ctx.db, tesco.id, shop);

      const synced = getChanges(ctx.db).changes.lists.find((l) => l.id === tesco.id);
      expect(synced).toMatchObject({ latitude: 53.2274, longitude: -4.1293, radiusM: 75 });
      expect(listLists(ctx.db).find((l) => l.id === tesco.id)?.location).toEqual(shop);
    });
  });
});
