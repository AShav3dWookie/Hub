import { describe, it, expect } from "vitest";
import type { Category } from "../categories.js";
import type { LogWithEntityDTO, PersonRef } from "../types.js";
import { computePersonStats } from "./personStats.js";

let nextId = 1;

function appearance(category: Category, people: PersonRef[]): LogWithEntityDTO {
  const id = nextId++;
  return {
    id,
    entityId: 100 + id,
    rating: null,
    date: "2026-01-01",
    notes: null,
    people,
    photos: [],
    albums: [],
    autoDelete: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entity: {
      id: 100 + id,
      category,
      title: `Thing ${id}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      releaseYear: null,
      author: null,
    },
  } as LogWithEntityDTO;
}

const ME = 1;
const ada: PersonRef = { id: 2, name: "Ada" };
const zoe: PersonRef = { id: 3, name: "Zoe" };
const me: PersonRef = { id: ME, name: "Me" };

describe("computePersonStats", () => {
  it("counts every appearance", () => {
    const stats = computePersonStats(ME, [appearance("movie", []), appearance("book", [])]);
    expect(stats.totalLogs).toBe(2);
  });

  it("reports nulls for someone with no appearances", () => {
    expect(computePersonStats(ME, [])).toEqual({
      totalLogs: 0,
      favoriteCategory: null,
      mostFrequentCoPerson: null,
    });
  });

  it("picks the most common category", () => {
    const stats = computePersonStats(ME, [
      appearance("movie", []),
      appearance("movie", []),
      appearance("book", []),
    ]);
    expect(stats.favoriteCategory).toBe("movie");
  });

  it("breaks a category tie alphabetically, not by input order", () => {
    const moviesFirst = computePersonStats(ME, [appearance("movie", []), appearance("book", [])]);
    const booksFirst = computePersonStats(ME, [appearance("book", []), appearance("movie", [])]);
    expect(moviesFirst.favoriteCategory).toBe("book");
    expect(booksFirst.favoriteCategory).toBe("book");
  });

  it("ignores a person-category appearance when picking a favourite", () => {
    const stats = computePersonStats(ME, [appearance("person", []), appearance("game", [])]);
    expect(stats.favoriteCategory).toBe("game");
  });

  it("picks the most frequent co-person", () => {
    const stats = computePersonStats(ME, [
      appearance("movie", [me, ada, zoe]),
      appearance("movie", [me, ada]),
    ]);
    expect(stats.mostFrequentCoPerson).toEqual(ada);
  });

  it("never counts the person themselves", () => {
    const stats = computePersonStats(ME, [appearance("movie", [me]), appearance("movie", [me])]);
    expect(stats.mostFrequentCoPerson).toBeNull();
  });

  it("breaks a co-person tie by name, not by input order", () => {
    const adaFirst = computePersonStats(ME, [
      appearance("movie", [me, ada]),
      appearance("hang_out", [me, zoe]),
    ]);
    const zoeFirst = computePersonStats(ME, [
      appearance("hang_out", [me, zoe]),
      appearance("movie", [me, ada]),
    ]);
    expect(adaFirst.mostFrequentCoPerson).toEqual(ada);
    expect(zoeFirst.mostFrequentCoPerson).toEqual(ada);
  });

  it("breaks a same-name co-person tie by the lower id", () => {
    const twin = { id: 9, name: "Sam" };
    const otherTwin = { id: 4, name: "Sam" };
    const highFirst = computePersonStats(ME, [
      appearance("movie", [me, twin]),
      appearance("movie", [me, otherTwin]),
    ]);
    expect(highFirst.mostFrequentCoPerson).toEqual(otherTwin);
  });

  it("returns no co-person when nobody else is ever tagged", () => {
    const stats = computePersonStats(ME, [appearance("movie", []), appearance("book", [])]);
    expect(stats.mostFrequentCoPerson).toBeNull();
  });

  it("gives the same answer however the appearances are ordered", () => {
    const logs = [
      appearance("movie", [me, ada]),
      appearance("movie", [me, zoe]),
      appearance("book", [me, ada]),
      appearance("hang_out", [me, zoe]),
    ];
    const forward = computePersonStats(ME, logs);
    const backward = computePersonStats(ME, [...logs].reverse());
    expect(forward).toEqual(backward);
  });
});
