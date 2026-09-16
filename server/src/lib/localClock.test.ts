import { describe, it, expect } from "vitest";
import { addDaysISO, isValidTimeZone, localTime } from "./localClock.js";

describe("localTime", () => {
  it("is an hour ahead of UTC in London during British Summer Time", () => {
    expect(localTime(new Date("2026-09-14T20:00:00Z"), "Europe/London")).toEqual({
      dateISO: "2026-09-14",
      minutes: 21 * 60,
    });
  });

  it("matches UTC in London once the clocks go back", () => {
    // BST ends at 01:00 UTC on Sunday 2026-10-25.
    expect(localTime(new Date("2026-10-25T21:00:00Z"), "Europe/London")).toEqual({
      dateISO: "2026-10-25",
      minutes: 21 * 60,
    });
  });

  it("rolls the local date over before UTC does", () => {
    expect(localTime(new Date("2026-06-30T23:30:00Z"), "Europe/London")).toEqual({
      dateISO: "2026-07-01",
      minutes: 30,
    });
  });

  it("reports midnight as minute 0, not 24:00", () => {
    expect(localTime(new Date("2026-01-01T00:00:00Z"), "UTC").minutes).toBe(0);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects nonsense", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("addDaysISO", () => {
  it("crosses month and year ends", () => {
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-02-25", 7)).toBe("2026-03-04");
  });
});
