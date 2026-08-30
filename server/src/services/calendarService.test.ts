import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createLog } from "./logService.js";
import { findOrCreateEntity } from "./entityService.js";
import { createEntityNote } from "./entityNotesService.js";
import { getCalendarRange } from "./calendarService.js";
import type { LoggableCategory } from "@logger/shared";

describe("calendarService.getCalendarRange", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => ctx?.cleanup());

  function setup() {
    ctx = createTestDb();
    return ctx.db;
  }

  function log(category: LoggableCategory, title: string, date: string, notes: string | null = null) {
    return createLog(ctx.db, { category, title, rating: null, date, notes, people: [] });
  }

  function importantDate(person: string, tag: string, eventDate: string, body = "") {
    const entity = findOrCreateEntity(ctx.db, "person", person);
    return createEntityNote(ctx.db, entity.id, { category: "important_date", tag, eventDate, body });
  }

  // ---- important-date placement ----

  it("places an important date on its month+day in whichever year is viewed", () => {
    const db = setup();
    importantDate("Alice", "Birthday", "1990-08-25");

    expect(getCalendarRange(db, "2020-08-01", "2020-08-31").items.map((i) => i.date)).toEqual([
      "2020-08-25",
    ]);
    expect(getCalendarRange(db, "2030-08-01", "2030-08-31").items[0].date).toBe("2030-08-25");
    expect(getCalendarRange(db, "2020-07-01", "2020-07-31").items).toEqual([]);
  });

  it("skips Feb 29 in a non-leap year instead of rolling it to Mar 1", () => {
    const db = setup();
    importantDate("Leap", "Anniversary", "2000-02-29");

    expect(getCalendarRange(db, "2024-02-01", "2024-02-29").items.map((i) => i.date)).toEqual([
      "2024-02-29",
    ]);
    expect(getCalendarRange(db, "2023-02-01", "2023-02-28").items).toEqual([]);
    expect(getCalendarRange(db, "2023-03-01", "2023-03-31").items).toEqual([]);
  });

  it("skips a day-31 important date in a 30-day month", () => {
    const db = setup();
    importantDate("Bill", "Renewal", "2020-01-31");
    expect(getCalendarRange(db, "2025-04-01", "2025-04-30").items).toEqual([]);
    expect(getCalendarRange(db, "2025-01-01", "2025-01-31").items.map((i) => i.date)).toEqual([
      "2025-01-31",
    ]);
  });

  it("places each recurrence once when the range straddles a Dec/Jan boundary", () => {
    const db = setup();
    importantDate("Dec", "NYE prep", "1990-12-30");
    importantDate("Jan", "New job", "1990-01-02");

    const { items } = getCalendarRange(db, "2024-12-30", "2025-02-09");
    expect(items.map((i) => i.date)).toEqual(["2024-12-30", "2025-01-02"]);
  });

  it("excludes notes with no tag or no eventDate, and non-important_date notes carrying an eventDate", () => {
    const db = setup();
    const alice = findOrCreateEntity(db, "person", "Alice");
    createEntityNote(db, alice.id, { category: "important_date", tag: "X", eventDate: "", body: "" });
    createEntityNote(db, alice.id, { category: "gift_idea", body: "socks", eventDate: "2000-08-10" });
    // a real one, to prove the query runs
    importantDate("Bob", "Birthday", "1988-08-10");

    const { items } = getCalendarRange(db, "2025-08-01", "2025-08-31");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Bob", tag: "Birthday", kind: "important_date" });
  });

  it("returns important dates on non-person entities with entityCategory reflecting the entity", () => {
    const db = setup();
    const car = findOrCreateEntity(db, "appointment", "The car");
    createEntityNote(db, car.id, { category: "important_date", tag: "MOT", eventDate: "2020-08-14", body: "" });

    const { items } = getCalendarRange(db, "2026-08-01", "2026-08-31");
    expect(items[0]).toMatchObject({ kind: "important_date", entityCategory: "appointment", date: "2026-08-14" });
  });

  it("maps an empty note body to null and carries the tag", () => {
    const db = setup();
    importantDate("Alice", "Birthday", "1990-08-25", "");
    importantDate("Bob", "Birthday", "1990-08-26", "bring balloons");

    const { items } = getCalendarRange(db, "2025-08-01", "2025-08-31");
    expect(items.find((i) => i.title === "Alice")?.notes).toBeNull();
    expect(items.find((i) => i.title === "Bob")?.notes).toBe("bring balloons");
  });

  // ---- logs ----

  it("includes eating_out / hang_out / appointment logs in range, at both boundaries", () => {
    const db = setup();
    log("eating_out", "Dishoom", "2020-08-01");
    log("hang_out", "Bowling", "2020-08-31");
    log("appointment", "Dentist", "2020-08-15");

    const { items } = getCalendarRange(db, "2020-08-01", "2020-08-31");
    expect(items.map((i) => i.title).sort()).toEqual(["Bowling", "Dentist", "Dishoom"]);
    expect(items.every((i) => i.kind === "log")).toBe(true);
  });

  it("excludes logs just outside the range", () => {
    const db = setup();
    log("hang_out", "Too early", "2020-07-31");
    log("hang_out", "Too late", "2020-09-01");
    expect(getCalendarRange(db, "2020-08-01", "2020-08-31").items).toEqual([]);
  });

  it("includes future-dated logs and after-the-fact logs alike", () => {
    const db = setup();
    log("hang_out", "Future picnic", "2099-08-10");
    // after-the-fact: createLog stamps createdAt to now, so this log's date is in the past relative to createdAt
    log("eating_out", "Last year's dinner", "2020-08-10");

    expect(getCalendarRange(db, "2099-08-01", "2099-08-31").items.map((i) => i.title)).toEqual([
      "Future picnic",
    ]);
    expect(getCalendarRange(db, "2020-08-01", "2020-08-31").items.map((i) => i.title)).toEqual([
      "Last year's dinner",
    ]);
  });

  it("excludes movie logs and year-granularity categories", () => {
    const db = setup();
    log("movie", "Dune", "2020-08-10");
    log("tv", "The Bear", "2020-01-01");
    log("book", "Dune", "2020-01-01");
    log("game", "Portal", "2020-01-01");

    expect(getCalendarRange(db, "2020-01-01", "2020-01-31").items).toEqual([]);
    expect(getCalendarRange(db, "2020-08-01", "2020-08-31").items).toEqual([]);
  });

  it("does not sweep expired auto-delete appointments", () => {
    const db = setup();
    const created = createLog(db, {
      category: "appointment",
      title: "Old dentist",
      rating: null,
      date: "2000-01-01",
      notes: null,
      people: [],
      autoDelete: true,
    });
    getCalendarRange(db, "2000-01-01", "2000-01-31");
    const still = db.$client.prepare("SELECT id FROM logs WHERE id = ?").get(created.id);
    expect(still).toBeTruthy();
  });

  // ---- shape ----

  it("sorts by date then title, echoes from/to", () => {
    const db = setup();
    log("hang_out", "Zoo", "2020-08-20");
    log("eating_out", "Apple", "2020-08-20");
    importantDate("Casey", "Birthday", "1990-08-05");

    const res = getCalendarRange(db, "2020-08-01", "2020-08-31");
    expect(res).toMatchObject({ from: "2020-08-01", to: "2020-08-31" });
    expect(res.items.map((i) => `${i.date}:${i.title}`)).toEqual([
      "2020-08-05:Casey",
      "2020-08-20:Apple",
      "2020-08-20:Zoo",
    ]);
  });

  it("carries logId for logs and noteId for important dates", () => {
    const db = setup();
    const l = log("hang_out", "Bowling", "2020-08-10");
    const n = importantDate("Alice", "Birthday", "1990-08-11");

    const { items } = getCalendarRange(db, "2020-08-01", "2020-08-31");
    const logItem = items.find((i) => i.kind === "log")!;
    const noteItem = items.find((i) => i.kind === "important_date")!;
    expect(logItem.logId).toBe(l.id);
    expect(logItem.noteId).toBeUndefined();
    expect(noteItem.noteId).toBe(n.id);
    expect(noteItem.logId).toBeUndefined();
  });

  it("returns an empty list for a quiet range", () => {
    const db = setup();
    expect(getCalendarRange(db, "2020-05-01", "2020-05-31").items).toEqual([]);
  });

  // ---- regression: a real grid range (Monday-before-1st .. Sunday-after) ----

  it("returns items across the whole grid range, spillover days included", () => {
    const db = setup();
    log("hang_out", "Jan spillover", "2024-01-30");
    log("eating_out", "Feb kickoff", "2024-02-01");
    importantDate("Dana", "Birthday", "1990-02-14");
    log("hang_out", "Mar spillover", "2024-03-02");
    log("hang_out", "Out of grid", "2024-03-10");

    const { items } = getCalendarRange(db, "2024-01-29", "2024-03-03");
    expect(items.map((i) => `${i.date}:${i.title}`)).toEqual([
      "2024-01-30:Jan spillover",
      "2024-02-01:Feb kickoff",
      "2024-02-14:Dana",
      "2024-03-02:Mar spillover",
    ]);
  });

  it("returns every log on a busy day and keeps them distinct", () => {
    const db = setup();
    log("eating_out", "Lunch", "2024-06-15", "12:30");
    log("hang_out", "Drinks", "2024-06-15", "8pm");
    log("appointment", "Haircut", "2024-06-15", null);

    const { items } = getCalendarRange(db, "2024-06-01", "2024-06-30");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.title)).toEqual(["Drinks", "Haircut", "Lunch"]); // title-sorted
    expect(items.map((i) => i.category)).toEqual(["hang_out", "appointment", "eating_out"]);
    expect(items.map((i) => i.notes)).toEqual(["8pm", null, "12:30"]);
  });

  it("treats repeat visits to one place as separate day items", () => {
    const db = setup();
    const dishoom = findOrCreateEntity(db, "eating_out", "Dishoom");
    createLog(db, { entityId: dishoom.id, rating: null, date: "2024-06-03", notes: null, people: [] });
    createLog(db, { entityId: dishoom.id, rating: null, date: "2024-06-19", notes: null, people: [] });

    const { items } = getCalendarRange(db, "2024-06-01", "2024-06-30");
    expect(items.map((i) => i.date)).toEqual(["2024-06-03", "2024-06-19"]);
    expect(new Set(items.map((i) => i.entityId))).toEqual(new Set([dishoom.id]));
    expect(new Set(items.map((i) => i.logId)).size).toBe(2);
  });

  it("carries the log's entity id, title and category for linking", () => {
    const db = setup();
    const l = log("hang_out", "Bowling", "2024-06-10");
    const { items } = getCalendarRange(db, "2024-06-01", "2024-06-30");
    expect(items[0]).toMatchObject({
      kind: "log",
      title: "Bowling",
      category: "hang_out",
      entityCategory: "hang_out",
      entityId: l.entityId,
      logId: l.id,
    });
  });

  it("returns a same-day log and important date together, deterministically ordered", () => {
    const db = setup();
    importantDate("Sam", "Birthday", "1990-06-10");
    log("hang_out", "Sam's party", "2024-06-10");

    const { items } = getCalendarRange(db, "2024-06-01", "2024-06-30");
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ["important_date", "Sam"],
      ["log", "Sam's party"],
    ]);
  });

  it("zero-pads the placed occurrence date", () => {
    const db = setup();
    importantDate("Early", "Birthday", "1990-03-05");
    const { items } = getCalendarRange(db, "2024-03-01", "2024-03-31");
    expect(items[0].date).toBe("2024-03-05");
  });

  it("sorts two important dates on the same day by person name", () => {
    const db = setup();
    importantDate("Zara", "Birthday", "1990-06-10");
    importantDate("Aaron", "Birthday", "1985-06-10");

    const { items } = getCalendarRange(db, "2024-06-01", "2024-06-30");
    expect(items.map((i) => i.title)).toEqual(["Aaron", "Zara"]);
  });
});
