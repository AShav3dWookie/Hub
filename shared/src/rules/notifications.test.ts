import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_SLOTS,
  isBirthdayTag,
  itemsOccurringOn,
  summariseNotification,
} from "./notifications.js";
import { bucketImportantDates, type ImportantDateNoteRow } from "./importantDates.js";
import type { UpcomingEventLogRow } from "./upcomingEvents.js";

function note(overrides: Partial<ImportantDateNoteRow> = {}): ImportantDateNoteRow {
  return {
    noteId: 1,
    entityId: 10,
    entityName: "Sarah",
    tag: "Birthday",
    eventDate: "1990-09-15",
    body: "",
    ...overrides,
  };
}

function event(overrides: Partial<UpcomingEventLogRow> = {}): UpcomingEventLogRow {
  return {
    logId: 1,
    entityId: 20,
    entityTitle: "Bowling",
    category: "hang_out",
    date: "2026-09-15",
    notes: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    people: [],
    ...overrides,
  };
}

describe("isBirthdayTag", () => {
  it("matches any tag mentioning a birthday, whatever the case", () => {
    expect(isBirthdayTag("Birthday")).toBe(true);
    expect(isBirthdayTag("30th BIRTHDAY")).toBe(true);
    expect(isBirthdayTag("birthday party")).toBe(true);
  });

  it("does not match other tags or a missing one", () => {
    expect(isBirthdayTag("Anniversary")).toBe(false);
    expect(isBirthdayTag("")).toBe(false);
    expect(isBirthdayTag(null)).toBe(false);
  });
});

describe("itemsOccurringOn", () => {
  it("names an important date on its annual occurrence, and not the day before", () => {
    expect(itemsOccurringOn([note()], [], "2026-09-15")).toEqual([
      { key: "note:1", label: "Sarah — Birthday" },
    ]);
    expect(itemsOccurringOn([note()], [], "2026-09-14")).toEqual([]);
  });

  it("names a planned hang-out or appointment with who it is with", () => {
    const items = itemsOccurringOn(
      [],
      [
        event({ people: [{ id: 5, name: "Ada" }, { id: 6, name: "Zoe" }] }),
        event({ logId: 2, entityTitle: "Dentist", category: "appointment" }),
      ],
      "2026-09-15",
    );
    expect(items).toEqual([
      { key: "log:1", label: "Bowling with Ada, Zoe" },
      { key: "log:2", label: "Dentist" },
    ]);
  });

  it("never reminds about a log written after the fact", () => {
    expect(
      itemsOccurringOn([], [event({ createdAt: "2026-09-15T20:00:00.000Z" })], "2026-09-15"),
    ).toEqual([]);
  });

  it("ignores categories that are not events, and other note categories", () => {
    const items = itemsOccurringOn(
      [note({ category: "general" })],
      [event({ category: "eating_out" }), event({ logId: 2, category: "movie" })],
      "2026-09-15",
    );
    expect(items).toEqual([]);
  });

  it("skips an important date missing its tag or date", () => {
    expect(
      itemsOccurringOn([note({ tag: null }), note({ noteId: 2, eventDate: null })], [], "2026-09-15"),
    ).toEqual([]);
  });

  it("limits a birthdays-only slot to birthday important dates", () => {
    const items = itemsOccurringOn(
      [note(), note({ noteId: 2, entityName: "Tom", tag: "Anniversary" })],
      [event()],
      "2026-09-15",
      { birthdaysOnly: true },
    );
    expect(items.map((i) => i.key)).toEqual(["note:1"]);
  });

  it("orders by name, then notes before logs, then id", () => {
    const items = itemsOccurringOn(
      [note({ noteId: 3, entityName: "Zoe" }), note({ noteId: 2, entityName: "Ada" })],
      [event({ logId: 9, entityTitle: "Ada" }), event({ logId: 4, entityTitle: "Bowling" })],
      "2026-09-15",
    );
    expect(items.map((i) => i.key)).toEqual(["note:2", "log:9", "log:4", "note:3"]);
  });

  it("puts a Feb 29 date on the same day the home widget does in a non-leap year", () => {
    const leapling = note({ eventDate: "2000-02-29" });
    const home = bucketImportantDates([leapling], new Date("2027-03-01T00:00:00.000Z"));
    expect(home.today).toHaveLength(1);
    expect(itemsOccurringOn([leapling], [], "2027-03-01")).toHaveLength(1);
    expect(itemsOccurringOn([leapling], [], "2027-02-28")).toEqual([]);
  });
});

describe("summariseNotification", () => {
  const a = { key: "note:1", label: "Sarah — Birthday" };
  const b = { key: "log:2", label: "Dentist" };

  it("says nothing when every section is empty", () => {
    expect(summariseNotification([{ heading: "Today", items: [] }])).toBeNull();
  });

  it("titles the notification after its only section and lists the items", () => {
    expect(summariseNotification([{ heading: "Tomorrow", items: [a, b] }])).toEqual({
      title: "Tomorrow",
      body: "Sarah — Birthday · Dentist",
    });
  });

  it("gives each later section its own labelled line", () => {
    expect(
      summariseNotification([
        { heading: "Today", items: [b] },
        { heading: "In a week", items: [a] },
      ]),
    ).toEqual({ title: "Today", body: "Dentist\nIn a week: Sarah — Birthday" });
  });

  it("titles after the first section that has something in it", () => {
    expect(
      summariseNotification([
        { heading: "Today", items: [] },
        { heading: "In a week", items: [a] },
      ]),
    ).toEqual({ title: "In a week", body: "Sarah — Birthday" });
  });
});

describe("NOTIFICATION_SLOTS", () => {
  it("reminds at 9am on the day, 9am a week before a birthday, and 9pm the evening before", () => {
    expect(
      NOTIFICATION_SLOTS.map(({ slot, startMinute, dayOffset, birthdaysOnly }) => ({
        slot,
        at: `${Math.floor(startMinute / 60)}:00`,
        dayOffset,
        birthdaysOnly,
      })),
    ).toEqual([
      { slot: "morning", at: "9:00", dayOffset: 0, birthdaysOnly: false },
      { slot: "week_ahead", at: "9:00", dayOffset: 7, birthdaysOnly: true },
      { slot: "evening", at: "21:00", dayOffset: 1, birthdaysOnly: false },
    ]);
  });

  it("closes the morning slots at midday and the evening slot at midnight", () => {
    expect(NOTIFICATION_SLOTS.map((s) => s.endMinute)).toEqual([720, 720, 1440]);
  });
});
