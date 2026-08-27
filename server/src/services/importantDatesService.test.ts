import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { findOrCreateEntity } from "./entityService.js";
import { createEntityNote } from "./entityNotesService.js";
import { getUpcomingImportantDates } from "./importantDatesService.js";

describe("importantDatesService", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("buckets a note whose month/day matches today into 'today'", () => {
    ctx = createTestDb();
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    createEntityNote(ctx.db, sarah.id, {
      category: "important_date",
      body: "Don't forget the card!",
      tag: "Birthday",
      eventDate: "1990-06-15",
    });

    const result = getUpcomingImportantDates(ctx.db, new Date("2024-06-15T12:00:00Z"));

    expect(result.today).toHaveLength(1);
    expect(result.today[0].entityName).toBe("Sarah");
    expect(result.today[0].tag).toBe("Birthday");
    expect(result.today[0].nextOccurrence).toBe("2024-06-15");
    expect(result.next7Days).toHaveLength(0);
  });

  it("buckets a note within the next 7 days (excluding today)", () => {
    ctx = createTestDb();
    const jamie = findOrCreateEntity(ctx.db, "person", "Jamie");
    createEntityNote(ctx.db, jamie.id, {
      category: "important_date",
      body: "",
      tag: "Anniversary",
      eventDate: "2015-06-20",
    });

    const result = getUpcomingImportantDates(ctx.db, new Date("2024-06-15T12:00:00Z"));

    expect(result.today).toHaveLength(0);
    expect(result.next7Days).toHaveLength(1);
    expect(result.next7Days[0].nextOccurrence).toBe("2024-06-20");
  });

  it("wraps recurrence into next year when the month/day has already passed this year", () => {
    ctx = createTestDb();
    const alice = findOrCreateEntity(ctx.db, "person", "Alice");
    createEntityNote(ctx.db, alice.id, {
      category: "important_date",
      body: "",
      tag: "Birthday",
      eventDate: "1990-01-02",
    });

    const result = getUpcomingImportantDates(ctx.db, new Date("2024-12-30T12:00:00Z"));

    expect(result.next7Days).toHaveLength(1);
    expect(result.next7Days[0].nextOccurrence).toBe("2025-01-02");
  });

  it("excludes notes outside the 7-day window", () => {
    ctx = createTestDb();
    const bob = findOrCreateEntity(ctx.db, "person", "Bob");
    createEntityNote(ctx.db, bob.id, {
      category: "important_date",
      body: "",
      tag: "Birthday",
      eventDate: "1990-09-01",
    });

    const result = getUpcomingImportantDates(ctx.db, new Date("2024-06-15T12:00:00Z"));

    expect(result.today).toHaveLength(0);
    expect(result.next7Days).toHaveLength(0);
  });

  it("ignores non-important_date notes", () => {
    ctx = createTestDb();
    const sarah = findOrCreateEntity(ctx.db, "person", "Sarah");
    createEntityNote(ctx.db, sarah.id, { category: "general", body: "Loves hiking" });

    const result = getUpcomingImportantDates(ctx.db, new Date("2024-06-15T12:00:00Z"));

    expect(result.today).toHaveLength(0);
    expect(result.next7Days).toHaveLength(0);
  });
});
