import { describe, it, expect } from "vitest";
import { updateDateRange } from "./updateDateRange.js";

describe("updateDateRange", () => {
  it("mirrors the entered start into a blank end", () => {
    expect(updateDateRange("start", "2024-09-01", { start: "", end: "" })).toEqual({
      start: "2024-09-01",
      end: "2024-09-01",
    });
  });

  it("mirrors the entered end into a blank start", () => {
    expect(updateDateRange("end", "2024-09-05", { start: "", end: "" })).toEqual({
      start: "2024-09-05",
      end: "2024-09-05",
    });
  });

  it("does not overwrite an end that is already set", () => {
    expect(updateDateRange("start", "2024-09-01", { start: "", end: "2024-09-10" })).toEqual({
      start: "2024-09-01",
      end: "2024-09-10",
    });
  });

  it("does not overwrite a start that is already set", () => {
    expect(updateDateRange("end", "2024-09-10", { start: "2024-09-01", end: "" })).toEqual({
      start: "2024-09-01",
      end: "2024-09-10",
    });
  });

  it("clearing one side leaves the other untouched", () => {
    expect(updateDateRange("start", "", { start: "2024-09-01", end: "2024-09-05" })).toEqual({
      start: "",
      end: "2024-09-05",
    });
    expect(updateDateRange("end", "", { start: "2024-09-01", end: "2024-09-05" })).toEqual({
      start: "2024-09-01",
      end: "",
    });
  });
});
