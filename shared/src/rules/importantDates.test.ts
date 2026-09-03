import { describe, it, expect } from "vitest";
import { bucketImportantDates, type ImportantDateNoteRow } from "./importantDates.js";

const today = new Date("2026-09-03T12:00:00.000Z");

function note(overrides: Partial<ImportantDateNoteRow> = {}): ImportantDateNoteRow {
  return {
    noteId: 1,
    entityId: 10,
    entityName: "Ada",
    tag: "Birthday",
    eventDate: "1990-09-03",
    body: "",
    ...overrides,
  };
}

describe("bucketImportantDates", () => {
  it("places a date recurring today in the today bucket", () => {
    const result = bucketImportantDates([note()], today);
    expect(result.today.map((e) => e.entityName)).toEqual(["Ada"]);
    expect(result.next7Days).toEqual([]);
  });

  it("computes the next occurrence in the current year, ignoring the stored year", () => {
    const result = bucketImportantDates([note({ eventDate: "1975-09-05" })], today);
    expect(result.next7Days[0].nextOccurrence).toBe("2026-09-05");
    expect(result.next7Days[0].eventDate).toBe("1975-09-05");
  });

  it("drops a date that has already passed this year and lands beyond the window", () => {
    const result = bucketImportantDates([note({ eventDate: "1990-01-15" })], today);
    expect(result.today).toEqual([]);
    expect(result.next7Days).toEqual([]);
  });

  it("includes the seventh day and excludes the eighth", () => {
    const result = bucketImportantDates(
      [
        note({ noteId: 1, entityName: "Seventh", eventDate: "1990-09-10" }),
        note({ noteId: 2, entityName: "Eighth", eventDate: "1990-09-11" }),
      ],
      today,
    );
    expect(result.next7Days.map((e) => e.entityName)).toEqual(["Seventh"]);
  });

  it("skips a note with no tag or no event date", () => {
    const result = bucketImportantDates(
      [note({ noteId: 1, tag: null }), note({ noteId: 2, eventDate: null })],
      today,
    );
    expect(result.today).toEqual([]);
    expect(result.next7Days).toEqual([]);
  });

  it("ignores a note that is not an important_date when the category is supplied", () => {
    const result = bucketImportantDates([note({ category: "general" })], today);
    expect(result.today).toEqual([]);
  });

  it("accepts a row with no category field at all", () => {
    const result = bucketImportantDates([note({ category: undefined })], today);
    expect(result.today).toHaveLength(1);
  });

  it("orders today's bucket by name", () => {
    const result = bucketImportantDates(
      [
        note({ noteId: 1, entityName: "Zoe" }),
        note({ noteId: 2, entityName: "Ada" }),
        note({ noteId: 3, entityName: "Mo" }),
      ],
      today,
    );
    expect(result.today.map((e) => e.entityName)).toEqual(["Ada", "Mo", "Zoe"]);
  });

  it("orders the next 7 days by occurrence, then by name", () => {
    const result = bucketImportantDates(
      [
        note({ noteId: 1, entityName: "Zoe", eventDate: "1990-09-05" }),
        note({ noteId: 2, entityName: "Ada", eventDate: "1990-09-05" }),
        note({ noteId: 3, entityName: "Bob", eventDate: "1990-09-04" }),
      ],
      today,
    );
    expect(result.next7Days.map((e) => e.entityName)).toEqual(["Bob", "Ada", "Zoe"]);
  });

  it("carries the note body and ids through to the entry", () => {
    const result = bucketImportantDates(
      [note({ noteId: 7, entityId: 42, body: "ring her" })],
      today,
    );
    expect(result.today[0]).toMatchObject({ noteId: 7, entityId: 42, body: "ring her", tag: "Birthday" });
  });

  it("rolls a Feb 29 date to Mar 1 in a non-leap year", () => {
    const lateFeb = new Date("2026-02-27T12:00:00.000Z");
    const result = bucketImportantDates([note({ eventDate: "2024-02-29" })], lateFeb);
    expect(result.next7Days[0].nextOccurrence).toBe("2026-03-01");
  });
});
