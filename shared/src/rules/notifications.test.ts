import { describe, it, expect } from "vitest";
import {
  HOUR_BEFORE,
  NOTIFICATION_SLOTS,
  appointmentsStartingSoon,
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

describe("itemsOccurringOn with times", () => {
  const dentist = event({ logId: 7, entityTitle: "Dentist", category: "appointment", time: "15:00" });

  it("names a timed appointment's time", () => {
    expect(itemsOccurringOn([], [dentist], "2026-09-15")).toEqual([{ key: "log:7", label: "Dentist at 15:00" }]);
  });

  it("leaves timed appointments out of an untimed-only slot, and keeps the rest", () => {
    const bowling = event({ logId: 8 });
    const haircut = event({ logId: 9, entityTitle: "Haircut", category: "appointment" });
    expect(
      itemsOccurringOn([note()], [dentist, bowling, haircut], "2026-09-15", { untimedOnly: true }).map((i) => i.key),
    ).toEqual(["log:8", "log:9", "note:1"]);
  });

  it("lists the untimed first, then by time", () => {
    const haircut = event({ logId: 9, entityTitle: "Haircut", category: "appointment", time: "09:30" });
    expect(itemsOccurringOn([note()], [dentist, haircut], "2026-09-15").map((i) => i.label)).toEqual([
      "Sarah — Birthday",
      "Haircut at 09:30",
      "Dentist at 15:00",
    ]);
  });
});

describe("appointmentsStartingSoon", () => {
  const dentist = event({ logId: 7, entityTitle: "Dentist", category: "appointment", time: "15:00" });
  const at = (hh: number, mm: number) => hh * 60 + mm;
  const soon = (rows: UpcomingEventLogRow[], minutes: number, date = "2026-09-15") =>
    appointmentsStartingSoon(rows, date, minutes, "2026-09-16");

  it("is an hour long", () => {
    expect(HOUR_BEFORE.leadMinutes).toBe(60);
  });

  it("opens exactly an hour before the start, and not a minute earlier", () => {
    expect(soon([dentist], at(14, 0))).toEqual([
      { dateISO: "2026-09-15", item: { key: "log:7", label: "Dentist at 15:00" }, startsIn: 60 },
    ]);
    expect(soon([dentist], at(13, 59))).toEqual([]);
  });

  it("stays open up to the start and closes at it", () => {
    expect(soon([dentist], at(14, 59))).toHaveLength(1);
    expect(soon([dentist], at(15, 0))).toEqual([]);
    expect(soon([dentist], at(16, 0))).toEqual([]);
  });

  it("ignores untimed appointments, hang-outs and other days", () => {
    const rows = [
      event({ logId: 1, category: "appointment" }),
      event({ logId: 2, time: "15:00" }),
      event({ logId: 3, category: "appointment", time: "15:00", date: "2026-09-14" }),
    ];
    expect(soon(rows, at(14, 30))).toEqual([]);
  });

  it("never reminds about one logged after it started", () => {
    expect(soon([{ ...dentist, createdAt: "2026-09-15T15:30:00.000Z" }], at(14, 30))).toEqual([]);
  });

  it("reaches across midnight to tomorrow's early appointment, under its own date", () => {
    const early = event({ logId: 4, entityTitle: "Flight", category: "appointment", time: "00:30", date: "2026-09-16" });
    expect(soon([early], at(23, 30))).toEqual([
      { dateISO: "2026-09-16", item: { key: "log:4", label: "Flight at 00:30" }, startsIn: 60 },
    ]);
    expect(soon([early], at(23, 29))).toEqual([]);
  });

  it("orders by start, then title", () => {
    const rows = [dentist, event({ logId: 5, entityTitle: "Car MOT", category: "appointment", time: "14:45" })];
    expect(soon(rows, at(14, 10)).map((s) => s.item.key)).toEqual(["log:5", "log:7"]);
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

  it("leaves timed appointments out of 9am only: the night before still names them", () => {
    expect(NOTIFICATION_SLOTS.filter((s) => s.untimedOnly).map((s) => s.slot)).toEqual(["morning"]);
  });
});
