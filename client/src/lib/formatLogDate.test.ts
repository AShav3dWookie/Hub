import { describe, expect, it } from "vitest";
import { formatLogDate } from "./formatLogDate.js";

describe("formatLogDate", () => {
  it("shows only the year for year-granularity categories", () => {
    expect(formatLogDate("2024-01-01", "book")).toBe("2024");
    expect(formatLogDate("2024-01-01", "tv")).toBe("2024");
    expect(formatLogDate("2024-01-01", "game")).toBe("2024");
  });

  it("leaves day-granularity dates unchanged", () => {
    expect(formatLogDate("2024-03-05", "movie")).toBe("2024-03-05");
    expect(formatLogDate("2024-03-05", "eating_out")).toBe("2024-03-05");
    expect(formatLogDate("2024-03-05", "hang_out")).toBe("2024-03-05");
    expect(formatLogDate("2024-03-05", "appointment")).toBe("2024-03-05");
  });

  it("returns the date unchanged for non-loggable categories", () => {
    expect(formatLogDate("2024-03-05", "person")).toBe("2024-03-05");
  });

  it("is a no-op when a year-granularity date is already a bare year", () => {
    expect(formatLogDate("2024", "book")).toBe("2024");
  });

  it("keeps a full timestamp's date portion for day-granularity categories", () => {
    expect(formatLogDate("2024-03-05T12:00:00.000Z", "movie")).toBe(
      "2024-03-05T12:00:00.000Z",
    );
  });
});
