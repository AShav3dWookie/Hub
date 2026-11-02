import { describe, it, expect } from "vitest";
import { parseWithRules } from "./voiceRules.js";

const LISTS = [
  { id: 1, name: "Shopping", isDefault: true },
  { id: 2, name: "Sainsbury's – Bangor", isDefault: false },
  { id: 3, name: "Tesco Bangor", isDefault: false },
  { id: 4, name: "Tesco Express", isDefault: false },
];

const parse = (text: string) => parseWithRules(text, LISTS);

describe("parseWithRules — the backup when the model can't be reached", () => {
  it("adds to the main list when no list is named", () => {
    expect(parse("Add eggs")).toEqual({ listId: null, items: ["eggs"] });
    expect(parse("add eggs to the shopping list")).toEqual({ listId: null, items: ["eggs"] });
    expect(parse("put eggs on my list.")).toEqual({ listId: null, items: ["eggs"] });
  });

  it("matches a named list by its words, ignoring apostrophes and punctuation", () => {
    expect(parse("add eggs to the sainsburys list")).toEqual({ listId: 2, items: ["eggs"] });
    expect(parse("add bread to sainsbury's bangor")).toEqual({ listId: 2, items: ["bread"] });
  });

  it("sends a list name that fits two lists to the main list rather than guessing", () => {
    expect(parse("add milk to the tesco list")).toEqual({ listId: null, items: ["milk"] });
    expect(parse("add milk to the tesco express list")).toEqual({ listId: 4, items: ["milk"] });
  });

  it("still treats '… to the X list' as a list when there's no such list", () => {
    expect(parse("add eggs to the lidl list")).toEqual({ listId: null, items: ["eggs"] });
  });

  it("keeps 'to' inside an item when what follows names no list", () => {
    expect(parse("add tickets to paris")).toEqual({ listId: null, items: ["tickets to paris"] });
  });

  it("never splits items, so 'fish and chips' survives — at the cost of 'eggs and milk'", () => {
    expect(parse("add fish and chips")).toEqual({ listId: null, items: ["fish and chips"] });
    expect(parse("add eggs and milk to tesco express")).toEqual({
      listId: 4,
      items: ["eggs and milk"],
    });
  });

  it("drops politeness and filler", () => {
    expect(parse("please add some eggs")).toEqual({ listId: null, items: ["eggs"] });
    expect(parse("can you put a new toothbrush on the sainsburys list")).toEqual({
      listId: 2,
      items: ["new toothbrush"],
    });
  });

  it("takes a command without add or put only when it names a list", () => {
    expect(parse("washing up liquid on the shopping list")).toEqual({ listId: null, items: ["washing up liquid"] });
    expect(parse("bread to sainsburys")).toEqual({ listId: 2, items: ["bread"] });
  });

  it("leaves anything else to the model rather than putting it on a list", () => {
    expect(parse("  washing up liquid ")).toBeNull();
    expect(parse("dentist next tuesday at 3")).toBeNull();
    expect(parse("what's on tomorrow")).toBeNull();
  });

  it("finds nothing to add in a command with no item", () => {
    expect(parse("add")).toEqual({ listId: null, items: [] });
    expect(parse("add to the tesco express list")).toEqual({ listId: 4, items: [] });
  });
});
