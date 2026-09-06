import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import {
  createLog,
  updateLog,
  deleteLog,
  getLogById,
  resolvePersonIds,
} from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

/**
 * The rejection paths of logService. The happy paths live in logService.test.ts; these are the
 * guards, which the route layer mostly shields from the existing tests.
 */
describe("logService rejections", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  const validLog = { rating: 4, date: "2026-01-01", notes: null, people: [] };

  it("refuses to log against a person entity", () => {
    ctx = createTestDb();
    const person = findOrCreateEntity(ctx.db, "person", "Ada");

    expect(() => createLog(ctx.db, { ...validLog, entityId: person.id })).toThrow(BadRequestError);
    expect(() => createLog(ctx.db, { ...validLog, entityId: person.id })).toThrow(
      /Cannot log against a person entity/,
    );
  });

  it("refuses to create a log under a non-loggable category", () => {
    ctx = createTestDb();
    expect(() =>
      createLog(ctx.db, {
        ...validLog,
        category: "person" as never,
        title: "Ada",
      }),
    ).toThrow(/not a loggable category/);
  });

  it("requires either an entity id or a category and title", () => {
    ctx = createTestDb();
    expect(() => createLog(ctx.db, validLog)).toThrow(BadRequestError);
    expect(() => createLog(ctx.db, validLog)).toThrow(/Either entityId or category\+title/);
  });

  it("requires a title alongside a category", () => {
    ctx = createTestDb();
    expect(() => createLog(ctx.db, { ...validLog, category: "movie" })).toThrow(BadRequestError);
  });

  it("reports a 404 when logging against an entity that does not exist", () => {
    ctx = createTestDb();
    expect(() => createLog(ctx.db, { ...validLog, entityId: 9999 })).toThrow(NotFoundError);
  });

  it("reports a 404 for reading, updating or deleting a log that does not exist", () => {
    ctx = createTestDb();
    expect(() => getLogById(ctx.db, 9999)).toThrow(NotFoundError);
    expect(() => updateLog(ctx.db, 9999, { ...validLog })).toThrow(NotFoundError);
    expect(() => deleteLog(ctx.db, 9999)).toThrow(NotFoundError);
  });

  it("refuses to tag a non-person entity as a person", () => {
    ctx = createTestDb();
    const movie = findOrCreateEntity(ctx.db, "movie", "Dune");

    expect(() => resolvePersonIds(ctx.db, [{ id: movie.id }])).toThrow(BadRequestError);
  });

  it("reports a 404 when tagging a person id that does not exist", () => {
    ctx = createTestDb();
    expect(() => resolvePersonIds(ctx.db, [{ id: 9999 }])).toThrow(NotFoundError);
  });

  it("creates a person on the fly when tagged by name", () => {
    ctx = createTestDb();
    const ids = resolvePersonIds(ctx.db, [{ name: "Ada Lovelace" }]);
    expect(ids).toHaveLength(1);

    // Tagging the same name again reuses the entity rather than duplicating it.
    expect(resolvePersonIds(ctx.db, [{ name: "  ada lovelace " }])).toEqual(ids);
  });

  it("tags nobody for an empty list", () => {
    ctx = createTestDb();
    expect(resolvePersonIds(ctx.db, [])).toEqual([]);
  });

  it("rejects a rating outside the allowed range", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "movie", "Dune");

    expect(() => createLog(ctx.db, { ...validLog, entityId: entity.id, rating: 0 })).toThrow(
      BadRequestError,
    );
    expect(() => createLog(ctx.db, { ...validLog, entityId: entity.id, rating: 6 })).toThrow(
      BadRequestError,
    );
  });

  it("accepts the ends of the rating range, and no rating at all", () => {
    ctx = createTestDb();
    const entity = findOrCreateEntity(ctx.db, "movie", "Dune");

    expect(() =>
      createLog(ctx.db, { ...validLog, entityId: entity.id, rating: 1 }),
    ).not.toThrow();
    expect(() =>
      createLog(ctx.db, { ...validLog, entityId: entity.id, rating: 5 }),
    ).not.toThrow();
    expect(() =>
      createLog(ctx.db, { ...validLog, entityId: entity.id, rating: null }),
    ).not.toThrow();
  });
});
