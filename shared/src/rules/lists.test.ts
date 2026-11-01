import { describe, it, expect } from "vitest";
import { assembleList, locationOf, summariseLists, type ListRow } from "./lists.js";

const list = (id: number, name: string, isDefault = false): ListRow => ({
  id,
  kind: "shopping",
  name,
  isDefault,
  latitude: null,
  longitude: null,
  radiusM: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

const item = (id: number, listId: number, text: string, createdAt: string) => ({
  id,
  listId,
  text,
  createdAt,
});

describe("summariseLists", () => {
  it("puts the main list first, then sorts by name ignoring case, then by id", () => {
    const rows = [list(1, "tesco"), list(2, "Shopping", true), list(3, "Aldi"), list(4, "Tesco")];
    expect(summariseLists(rows, [], "shopping").map((l) => l.id)).toEqual([2, 3, 1, 4]);
  });

  it("counts each list's items", () => {
    const rows = [list(1, "Shopping", true), list(2, "Tesco")];
    const items = [{ listId: 2 }, { listId: 2 }, { listId: 1 }];
    expect(summariseLists(rows, items, "shopping").map((l) => l.itemCount)).toEqual([1, 2]);
  });
});

describe("assembleList", () => {
  it("keeps only this list's items, oldest first, ties broken by id", () => {
    const items = [
      item(3, 1, "Bread", "2026-10-02T00:00:00.000Z"),
      item(9, 2, "Other list", "2026-10-01T00:00:00.000Z"),
      item(2, 1, "Milk", "2026-10-01T00:00:00.000Z"),
      item(1, 1, "Eggs", "2026-10-01T00:00:00.000Z"),
    ];
    const result = assembleList(list(1, "Shopping", true), items);
    expect(result.items.map((i) => i.text)).toEqual(["Eggs", "Milk", "Bread"]);
    expect(result.itemCount).toBe(3);
  });

  it("strips sync bookkeeping from the items it returns", () => {
    const synced = { ...item(1, 1, "Eggs", "2026-10-01T00:00:00.000Z"), rowSeq: 5, version: 2 };
    expect(assembleList(list(1, "Shopping", true), [synced]).items[0]).toEqual({
      id: 1,
      listId: 1,
      text: "Eggs",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
  });
});

describe("locationOf", () => {
  it("is the shop's location when all three columns are set", () => {
    expect(locationOf({ latitude: 53.2274, longitude: -4.1293, radiusM: 75 })).toEqual({
      latitude: 53.2274,
      longitude: -4.1293,
      radiusM: 75,
    });
  });

  it("is null for an untagged list, or a half-set one", () => {
    expect(locationOf({ latitude: null, longitude: null, radiusM: null })).toBeNull();
    expect(locationOf({ latitude: 53.2, longitude: null, radiusM: 75 })).toBeNull();
  });

  it("puts it on the lists screen's rows", () => {
    const tagged = { ...list(1, "Tesco", true), latitude: 53.2, longitude: -4.1, radiusM: 100 };
    expect(summariseLists([tagged, list(2, "Aldi")], [], "shopping").map((l) => l.location)).toEqual([
      { latitude: 53.2, longitude: -4.1, radiusM: 100 },
      null,
    ]);
  });
});
