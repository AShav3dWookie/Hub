import { describe, it, expect } from "vitest";
import { compareTimeOfDay, isTimeOfDay, minutesOfDay } from "./timeOfDay.js";

describe("isTimeOfDay", () => {
  it("accepts 24-hour HH:MM", () => {
    for (const t of ["00:00", "09:05", "15:30", "23:59"]) expect(isTimeOfDay(t)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const t of ["24:00", "9:05", "15:60", "15:30:00", "3pm", "", null, 930]) expect(isTimeOfDay(t)).toBe(false);
  });
});

describe("minutesOfDay", () => {
  it("counts minutes after midnight", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("15:30")).toBe(930);
    expect(minutesOfDay("23:59")).toBe(1439);
  });
});

describe("compareTimeOfDay", () => {
  it("puts untimed items first, then orders by time", () => {
    const times = ["15:00", null, "09:30", null, "10:00"];
    expect([...times].sort(compareTimeOfDay)).toEqual([null, null, "09:30", "10:00", "15:00"]);
  });

  it("treats two untimed items, or two equal times, as a tie", () => {
    expect(compareTimeOfDay(null, undefined)).toBe(0);
    expect(compareTimeOfDay("10:00", "10:00")).toBe(0);
  });
});
