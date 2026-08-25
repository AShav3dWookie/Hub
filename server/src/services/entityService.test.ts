import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { findOrCreateEntity, searchEntitiesByTitle } from "./entityService.js";

describe("entityService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("creates a new entity when none matches", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "movie", "Inception");
    expect(entity.id).toBeGreaterThan(0);
    expect(entity.title).toBe("Inception");
    expect(entity.category).toBe("movie");
  });

  it("dedupes on case/whitespace-insensitive title match within the same category", () => {
    ctx = createTestDb();
    const first = findOrCreateEntity(ctx.db, "restaurant", "Chipotle");
    const second = findOrCreateEntity(ctx.db, "restaurant", "  chipotle  ");
    expect(second.id).toBe(first.id);
  });

  it("does not dedupe the same title across different categories", () => {
    ctx = createTestDb();
    const movie = findOrCreateEntity(ctx.db, "movie", "Twister");
    const game = findOrCreateEntity(ctx.db, "game", "Twister");
    expect(movie.id).not.toBe(game.id);
  });

  it("autocompletes by partial, case-insensitive title", () => {
    ctx = createTestDb();
    findOrCreateEntity(ctx.db, "restaurant", "Chipotle Mexican Grill");
    findOrCreateEntity(ctx.db, "restaurant", "Burger King");
    const results = searchEntitiesByTitle(ctx.db, "restaurant", "chip");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Chipotle Mexican Grill");
  });
});
