import { describe, it, expect } from "vitest";
import {
  addMonths,
  dayLabel,
  daysInMonth,
  gridRange,
  monthGrid,
  monthLabel,
  WEEKDAYS,
} from "./calendar.js";

describe("daysInMonth", () => {
  it("handles leap and non-leap February", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
    expect(daysInMonth(1900, 2)).toBe(28); // divisible by 100 but not 400
  });

  it("handles 30- and 31-day months", () => {
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 1)).toBe(31);
    expect(daysInMonth(2024, 12)).toBe(31);
  });
});

describe("addMonths", () => {
  it("stays within a year", () => {
    expect(addMonths("2024-06", 1)).toBe("2024-07");
    expect(addMonths("2024-06", -1)).toBe("2024-05");
    expect(addMonths("2024-06", 0)).toBe("2024-06");
  });

  it("rolls the year in both directions and across multiple years", () => {
    expect(addMonths("2024-12", 1)).toBe("2025-01");
    expect(addMonths("2024-01", -1)).toBe("2023-12");
    expect(addMonths("2024-01", 13)).toBe("2025-02");
    expect(addMonths("2024-01", -13)).toBe("2022-12");
    expect(addMonths("2024-06", 24)).toBe("2026-06");
  });

  it("round-trips: n months forward then back", () => {
    for (const start of ["2023-01", "2024-07", "2024-12"]) {
      for (const delta of [1, 5, 12, 25]) {
        expect(addMonths(addMonths(start, delta), -delta)).toBe(start);
      }
    }
  });
});

describe("monthGrid", () => {
  it("is Monday-first, whole weeks, every cell a real date, contiguous", () => {
    const grid = monthGrid("2024-02");
    expect(grid[0]).toEqual({ date: "2024-01-29", inMonth: false }); // Monday of that week
    expect(grid.filter((c) => c.inMonth)).toHaveLength(29);
    expect(grid.length % 7).toBe(0);
    for (let i = 1; i < grid.length; i++) {
      const prev = new Date(`${grid[i - 1].date}T00:00:00Z`);
      const cur = new Date(`${grid[i].date}T00:00:00Z`);
      expect(cur.getTime() - prev.getTime()).toBe(86_400_000); // exactly one day apart
    }
  });

  it("has no leading spillover when the month starts on a Monday", () => {
    expect(monthGrid("2024-04")[0]).toEqual({ date: "2024-04-01", inMonth: true });
  });

  it("is exactly 4 rows for a 28-day February that starts on a Monday", () => {
    const grid = monthGrid("2021-02"); // Feb 2021: 28 days, starts Monday
    expect(grid).toHaveLength(28);
    expect(grid.every((c) => c.inMonth)).toBe(true);
  });

  it("is 6 rows for a 31-day month that starts on a Sunday", () => {
    const grid = monthGrid("2024-12"); // Dec 2024 starts on a Sunday
    expect(grid).toHaveLength(42);
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31);
    expect(grid[0].date).toBe("2024-11-25");
  });

  it("spans a year boundary for January", () => {
    const grid = monthGrid("2025-01"); // Jan 2025 starts on a Wednesday
    expect(grid[0].date).toBe("2024-12-30");
    expect(grid.filter((c) => c.inMonth).map((c) => c.date.slice(0, 7)).every((m) => m === "2025-01")).toBe(true);
  });
});

describe("gridRange", () => {
  it("returns the first and last grid cell dates", () => {
    expect(gridRange("2024-02")).toEqual({ from: "2024-01-29", to: "2024-03-03" });
    expect(gridRange("2024-04")).toEqual({ from: "2024-04-01", to: "2024-05-05" });
  });
});

describe("labels", () => {
  it("monthLabel names the month and year", () => {
    expect(monthLabel("2024-02")).toMatch(/February 2024/);
    expect(monthLabel("2025-12")).toMatch(/December 2025/);
  });

  it("dayLabel contains the weekday, day number, month and year", () => {
    const label = dayLabel("2024-02-29");
    expect(label).toMatch(/Thursday/);
    expect(label).toMatch(/29/);
    expect(label).toMatch(/February/);
    expect(label).toMatch(/2024/);
  });

  it("WEEKDAYS starts on Monday", () => {
    expect(WEEKDAYS).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
