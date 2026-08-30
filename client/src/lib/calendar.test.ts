import { describe, it, expect } from "vitest";
import { addMonths, daysInMonth, gridRange, monthGrid } from "./calendar.js";

describe("calendar month math", () => {
  it("daysInMonth handles leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });

  it("addMonths rolls the year", () => {
    expect(addMonths("2024-12", 1)).toBe("2025-01");
    expect(addMonths("2024-01", -1)).toBe("2023-12");
    expect(addMonths("2024-06", 0)).toBe("2024-06");
    expect(addMonths("2024-01", 13)).toBe("2025-02");
  });

  it("monthGrid is Monday-first, whole weeks, real dates", () => {
    const grid = monthGrid("2024-02"); // Feb 2024 starts on a Thursday
    expect(grid[0].date).toBe("2024-01-29"); // the Monday of that week
    expect(grid[0].inMonth).toBe(false);
    expect(grid.filter((c) => c.inMonth)).toHaveLength(29);
    expect(grid.length % 7).toBe(0);
    expect(grid.at(-1)!.inMonth).toBe(false);
  });

  it("monthGrid for a month starting on Monday has no leading spillover", () => {
    const grid = monthGrid("2024-04"); // Apr 2024 starts on a Monday
    expect(grid[0]).toEqual({ date: "2024-04-01", inMonth: true });
  });

  it("gridRange returns the first and last grid cell dates", () => {
    expect(gridRange("2024-02")).toEqual({ from: "2024-01-29", to: expect.stringMatching(/^2024-03-/) });
  });
});
