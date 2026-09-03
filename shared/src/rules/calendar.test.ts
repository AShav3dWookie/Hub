import { describe, it, expect } from "vitest";
import {
  buildCalendarRange,
  type CalendarLogRow,
  type CalendarNoteRow,
} from "./calendar.js";

function log(overrides: Partial<CalendarLogRow> = {}): CalendarLogRow {
  return {
    logId: 1,
    date: "2026-09-03",
    notes: null,
    entityId: 10,
    title: "Chipotle",
    category: "eating_out",
    ...overrides,
  };
}

function note(overrides: Partial<CalendarNoteRow> = {}): CalendarNoteRow {
  return {
    noteId: 1,
    category: "important_date",
    tag: "Birthday",
    eventDate: "1990-09-05",
    body: "",
    entityId: 20,
    entityName: "Ada",
    entityCategory: "person",
    ...overrides,
  };
}

describe("buildCalendarRange log placement", () => {
  it("echoes the requested range back", () => {
    const result = buildCalendarRange([], [], "2026-09-01", "2026-09-30");
    expect(result).toMatchObject({ from: "2026-09-01", to: "2026-09-30", items: [] });
  });

  it("includes a log inside the range, on both boundaries", () => {
    const result = buildCalendarRange(
      [log({ logId: 1, date: "2026-09-01" }), log({ logId: 2, date: "2026-09-30" })],
      [],
      "2026-09-01",
      "2026-09-30",
    );
    expect(result.items.map((i) => i.logId)).toEqual([1, 2]);
  });

  it("excludes a log outside the range", () => {
    const result = buildCalendarRange(
      [log({ logId: 1, date: "2026-08-31" }), log({ logId: 2, date: "2026-10-01" })],
      [],
      "2026-09-01",
      "2026-09-30",
    );
    expect(result.items).toEqual([]);
  });

  it("includes eating_out, hang_out and appointment but not movies", () => {
    const result = buildCalendarRange(
      [
        log({ logId: 1, category: "eating_out", title: "Chipotle" }),
        log({ logId: 2, category: "hang_out", title: "Bowling" }),
        log({ logId: 3, category: "appointment", title: "Dentist" }),
        log({ logId: 4, category: "movie", title: "Dune" }),
        log({ logId: 5, category: "book", title: "Dune the book" }),
      ],
      [],
      "2026-09-01",
      "2026-09-30",
    );
    expect(result.items.map((i) => i.title).sort()).toEqual(["Bowling", "Chipotle", "Dentist"]);
  });

  it("keeps past logs, unlike the upcoming widget", () => {
    const result = buildCalendarRange([log({ date: "2020-03-04" })], [], "2020-01-01", "2020-12-31");
    expect(result.items).toHaveLength(1);
  });
});

describe("buildCalendarRange important-date placement", () => {
  it("places a note on its annual occurrence inside the range", () => {
    const result = buildCalendarRange([], [note()], "2026-09-01", "2026-09-30");
    expect(result.items[0]).toMatchObject({
      date: "2026-09-05",
      kind: "important_date",
      category: "important_date",
      title: "Ada",
      tag: "Birthday",
      noteId: 1,
    });
  });

  it("places one occurrence per year the range spans", () => {
    const result = buildCalendarRange([], [note()], "2025-01-01", "2027-12-31");
    expect(result.items.map((i) => i.date)).toEqual(["2025-09-05", "2026-09-05", "2027-09-05"]);
  });

  it("skips a Feb 29 note in a non-leap year rather than rolling it forward", () => {
    const result = buildCalendarRange(
      [],
      [note({ eventDate: "2024-02-29" })],
      "2026-01-01",
      "2026-12-31",
    );
    expect(result.items).toEqual([]);
  });

  it("places a Feb 29 note in a leap year", () => {
    const result = buildCalendarRange(
      [],
      [note({ eventDate: "2024-02-29" })],
      "2028-01-01",
      "2028-12-31",
    );
    expect(result.items.map((i) => i.date)).toEqual(["2028-02-29"]);
  });

  it("skips the 31st in a short month", () => {
    const result = buildCalendarRange(
      [],
      [note({ eventDate: "1990-01-31" })],
      "2026-02-01",
      "2026-02-28",
    );
    expect(result.items).toEqual([]);
  });

  it("ignores a note that is not an important_date, or is missing tag or date", () => {
    const result = buildCalendarRange(
      [],
      [
        note({ noteId: 1, category: "general" }),
        note({ noteId: 2, tag: null }),
        note({ noteId: 3, eventDate: null }),
      ],
      "2026-01-01",
      "2026-12-31",
    );
    expect(result.items).toEqual([]);
  });

  it("normalises an empty note body to null", () => {
    const result = buildCalendarRange([], [note({ body: "" })], "2026-09-01", "2026-09-30");
    expect(result.items[0].notes).toBeNull();
  });

  it("carries a non-empty body through", () => {
    const result = buildCalendarRange([], [note({ body: "call her" })], "2026-09-01", "2026-09-30");
    expect(result.items[0].notes).toBe("call her");
  });
});

describe("buildCalendarRange ordering", () => {
  it("sorts by date first", () => {
    const result = buildCalendarRange(
      [log({ logId: 1, date: "2026-09-10" }), log({ logId: 2, date: "2026-09-02" })],
      [],
      "2026-09-01",
      "2026-09-30",
    );
    expect(result.items.map((i) => i.date)).toEqual(["2026-09-02", "2026-09-10"]);
  });

  it("breaks a date tie by title, then kind, then id", () => {
    const result = buildCalendarRange(
      [
        log({ logId: 5, date: "2026-09-05", title: "Zoo" }),
        log({ logId: 3, date: "2026-09-05", title: "Ada" }),
        log({ logId: 2, date: "2026-09-05", title: "Ada" }),
      ],
      [note({ noteId: 9, eventDate: "1990-09-05", entityName: "Ada" })],
      "2026-09-01",
      "2026-09-30",
    );
    // "Ada" before "Zoo"; within Ada, kind "important_date" sorts before "log"; then by id.
    expect(result.items.map((i) => [i.title, i.kind, i.logId ?? i.noteId])).toEqual([
      ["Ada", "important_date", 9],
      ["Ada", "log", 2],
      ["Ada", "log", 3],
      ["Zoo", "log", 5],
    ]);
  });
});
