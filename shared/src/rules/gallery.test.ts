import { describe, it, expect } from "vitest";
import { DEFAULT_GALLERY_LIMIT, isAfterCursor, paginateByDescendingId } from "./gallery.js";

const items = (...ids: number[]) => ids.map((id) => ({ id }));
const idOf = (item: { id: number }) => item.id;

describe("DEFAULT_GALLERY_LIMIT", () => {
  it("is the one page size both sides use", () => {
    expect(DEFAULT_GALLERY_LIMIT).toBe(50);
  });
});

describe("isAfterCursor", () => {
  it("accepts everything when there is no cursor", () => {
    expect(isAfterCursor(100, undefined)).toBe(true);
  });

  it("accepts ids below the cursor and rejects the cursor itself", () => {
    expect(isAfterCursor(9, 10)).toBe(true);
    expect(isAfterCursor(10, 10)).toBe(false);
    expect(isAfterCursor(11, 10)).toBe(false);
  });
});

describe("paginateByDescendingId", () => {
  it("returns everything and no cursor when the list fits", () => {
    const result = paginateByDescendingId(items(5, 4, 3), 10, idOf);
    expect(result.page.map(idOf)).toEqual([5, 4, 3]);
    expect(result.nextCursor).toBeNull();
  });

  it("returns no cursor when the list is exactly the page size", () => {
    const result = paginateByDescendingId(items(5, 4, 3), 3, idOf);
    expect(result.page.map(idOf)).toEqual([5, 4, 3]);
    expect(result.nextCursor).toBeNull();
  });

  it("truncates to the limit and reports the last id as the cursor", () => {
    const result = paginateByDescendingId(items(5, 4, 3, 2), 3, idOf);
    expect(result.page.map(idOf)).toEqual([5, 4, 3]);
    expect(result.nextCursor).toBe(3);
  });

  it("handles an empty list", () => {
    const result = paginateByDescendingId([], 10, idOf);
    expect(result.page).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("does not mutate or alias the input", () => {
    const source = items(5, 4, 3);
    const result = paginateByDescendingId(source, 10, idOf);
    result.page.push({ id: 99 });
    expect(source).toHaveLength(3);
  });

  it("pages through a list with no repeats or gaps", () => {
    const all = items(...Array.from({ length: 10 }, (_, i) => 10 - i));
    const seen: number[] = [];
    let cursor: number | undefined;

    for (let guard = 0; guard < 10; guard++) {
      const remaining = all.filter((item) => isAfterCursor(item.id, cursor));
      const { page, nextCursor } = paginateByDescendingId(remaining, 3, idOf);
      seen.push(...page.map(idOf));
      if (nextCursor === null) break;
      cursor = nextCursor;
    }

    expect(seen).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
