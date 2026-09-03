import { describe, it, expect } from "vitest";
import { bucketByWindow } from "./window.js";

interface Row {
  id: number;
  date: string;
}

const today = new Date("2026-09-03T12:00:00.000Z");
const byId = (a: Row, b: Row) => a.id - b.id;
const rows = (...dates: [number, string][]): Row[] => dates.map(([id, date]) => ({ id, date }));

describe("bucketByWindow", () => {
  it("puts today's rows in the today bucket", () => {
    const result = bucketByWindow(rows([1, "2026-09-03"]), (r) => r.date, today, byId);
    expect(result.today.map((r) => r.id)).toEqual([1]);
    expect(result.next7Days).toEqual([]);
  });

  it("puts tomorrow through day seven in the next7Days bucket", () => {
    const result = bucketByWindow(
      rows([1, "2026-09-04"], [2, "2026-09-10"]),
      (r) => r.date,
      today,
      byId,
    );
    expect(result.today).toEqual([]);
    expect(result.next7Days.map((r) => r.id)).toEqual([1, 2]);
  });

  it("includes the last day of the window and excludes the day after", () => {
    const result = bucketByWindow(
      rows([1, "2026-09-10"], [2, "2026-09-11"]),
      (r) => r.date,
      today,
      byId,
    );
    expect(result.next7Days.map((r) => r.id)).toEqual([1]);
  });

  it("drops anything in the past", () => {
    const result = bucketByWindow(
      rows([1, "2026-09-02"], [2, "2020-01-01"]),
      (r) => r.date,
      today,
      byId,
    );
    expect(result.today).toEqual([]);
    expect(result.next7Days).toEqual([]);
  });

  it("sorts both buckets with the supplied comparator", () => {
    const result = bucketByWindow(
      rows([3, "2026-09-03"], [1, "2026-09-03"], [4, "2026-09-05"], [2, "2026-09-04"]),
      (r) => r.date,
      today,
      byId,
    );
    expect(result.today.map((r) => r.id)).toEqual([1, 3]);
    expect(result.next7Days.map((r) => r.id)).toEqual([2, 4]);
  });

  it("honours a custom window length", () => {
    const result = bucketByWindow(
      rows([1, "2026-09-04"], [2, "2026-09-06"]),
      (r) => r.date,
      today,
      byId,
      2,
    );
    expect(result.next7Days.map((r) => r.id)).toEqual([1]);
  });

  it("uses the UTC day of the given instant, not its clock time", () => {
    const lateInTheDay = new Date("2026-09-03T23:59:59.000Z");
    const result = bucketByWindow(rows([1, "2026-09-03"]), (r) => r.date, lateInTheDay, byId);
    expect(result.today.map((r) => r.id)).toEqual([1]);
  });

  it("returns empty buckets for no rows", () => {
    const result = bucketByWindow([], (r: Row) => r.date, today, byId);
    expect(result).toEqual({ today: [], next7Days: [] });
  });
});
