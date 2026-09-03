import { describe, it, expect } from "vitest";
import {
  addDaysUTC,
  addMonths,
  atMidnightUTC,
  daysBetween,
  daysInMonth,
  nextAnnualOccurrence,
  pad2,
  toISODate,
} from "./dates.js";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("toISODate", () => {
  it("formats a UTC instant as YYYY-MM-DD", () => {
    expect(toISODate(utc("2026-09-03"))).toBe("2026-09-03");
  });

  it("uses the UTC day, not the local one", () => {
    expect(toISODate(new Date("2026-09-03T23:30:00.000Z"))).toBe("2026-09-03");
    expect(toISODate(new Date("2026-09-04T00:30:00.000Z"))).toBe("2026-09-04");
  });
});

describe("atMidnightUTC", () => {
  it("truncates the time of day", () => {
    expect(atMidnightUTC(new Date("2026-09-03T17:45:12.345Z")).toISOString()).toBe(
      "2026-09-03T00:00:00.000Z",
    );
  });

  it("is idempotent", () => {
    const once = atMidnightUTC(new Date("2026-09-03T17:45:12.345Z"));
    expect(atMidnightUTC(once).getTime()).toBe(once.getTime());
  });
});

describe("pad2", () => {
  it("pads a single digit and leaves two alone", () => {
    expect(pad2(1)).toBe("01");
    expect(pad2(12)).toBe("12");
  });
});

describe("daysInMonth", () => {
  it("knows the ordinary month lengths", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("handles February in common and leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it("applies the century leap rule", () => {
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe("daysBetween", () => {
  it("counts whole days forward", () => {
    expect(daysBetween("2026-09-01", "2026-09-08")).toBe(7);
  });

  it("returns zero for the same day and a negative for a backwards range", () => {
    expect(daysBetween("2026-09-03", "2026-09-03")).toBe(0);
    expect(daysBetween("2026-09-08", "2026-09-01")).toBe(-7);
  });

  it("counts across a month, a year and a leap day", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("addDaysUTC", () => {
  it("adds days and truncates to midnight", () => {
    expect(toISODate(addDaysUTC(new Date("2026-09-03T17:00:00.000Z"), 7))).toBe("2026-09-10");
  });

  it("rolls over a month and a year boundary", () => {
    expect(toISODate(addDaysUTC(utc("2026-01-31"), 1))).toBe("2026-02-01");
    expect(toISODate(addDaysUTC(utc("2026-12-31"), 1))).toBe("2027-01-01");
  });

  it("subtracts with a negative delta", () => {
    expect(toISODate(addDaysUTC(utc("2026-03-01"), -1))).toBe("2026-02-28");
  });
});

describe("addMonths", () => {
  it("shifts within a year", () => {
    expect(addMonths("2026-01", 1)).toBe("2026-02");
  });

  it("rolls the year forward", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("rolls the year backward", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("handles a multi-year shift", () => {
    expect(addMonths("2026-06", 24)).toBe("2028-06");
  });
});

describe("nextAnnualOccurrence", () => {
  it("stays in this year when the date is still ahead", () => {
    expect(toISODate(nextAnnualOccurrence("1990-12-25", utc("2026-09-03")))).toBe("2026-12-25");
  });

  it("returns today when the occurrence is today", () => {
    expect(toISODate(nextAnnualOccurrence("1990-09-03", utc("2026-09-03")))).toBe("2026-09-03");
  });

  it("rolls to next year once the date has passed", () => {
    expect(toISODate(nextAnnualOccurrence("1990-01-15", utc("2026-09-03")))).toBe("2027-01-15");
  });

  it("ignores the stored year entirely", () => {
    const fromOld = nextAnnualOccurrence("1901-05-05", utc("2026-09-03"));
    const fromRecent = nextAnnualOccurrence("2020-05-05", utc("2026-09-03"));
    expect(toISODate(fromOld)).toBe(toISODate(fromRecent));
  });

  it("rolls a Feb 29 birthday to Mar 1 in a non-leap year, by documented design", () => {
    expect(toISODate(nextAnnualOccurrence("2024-02-29", utc("2026-01-01")))).toBe("2026-03-01");
  });

  it("keeps Feb 29 in a leap year", () => {
    expect(toISODate(nextAnnualOccurrence("2024-02-29", utc("2028-01-01")))).toBe("2028-02-29");
  });
});
