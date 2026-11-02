import { describe, it, expect } from "vitest";
import { bucketUpcomingEvents, isPlannedAhead, type UpcomingEventLogRow } from "./upcomingEvents.js";

const today = new Date("2026-09-03T12:00:00.000Z");

function row(overrides: Partial<UpcomingEventLogRow> = {}): UpcomingEventLogRow {
  return {
    logId: 1,
    entityId: 10,
    entityTitle: "Bowling",
    category: "hang_out",
    date: "2026-09-03",
    notes: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    people: [],
    ...overrides,
  };
}

describe("isPlannedAhead", () => {
  it("counts a timed appointment created earlier the same day as a plan", () => {
    const dentist = { date: "2026-09-03", time: "15:00" };
    expect(isPlannedAhead({ ...dentist, createdAt: "2026-09-03T10:00:00.000Z" })).toBe(true);
    expect(isPlannedAhead({ ...dentist, createdAt: "2026-09-03 14:59:00" })).toBe(true);
  });

  it("rejects a timed appointment created at or after its start", () => {
    const dentist = { date: "2026-09-03", time: "15:00" };
    expect(isPlannedAhead({ ...dentist, createdAt: "2026-09-03T15:00:00.000Z" })).toBe(false);
    expect(isPlannedAhead({ ...dentist, createdAt: "2026-09-04T09:00:00.000Z" })).toBe(false);
  });

  it("accepts a log created before the day it happens", () => {
    expect(isPlannedAhead({ createdAt: "2026-09-01T10:00:00.000Z", date: "2026-09-03" })).toBe(true);
  });

  it("rejects a log created on the day itself", () => {
    expect(isPlannedAhead({ createdAt: "2026-09-03T22:00:00.000Z", date: "2026-09-03" })).toBe(false);
  });

  it("rejects a log created after the fact", () => {
    expect(isPlannedAhead({ createdAt: "2026-09-05T10:00:00.000Z", date: "2026-09-03" })).toBe(false);
  });
});

describe("bucketUpcomingEvents", () => {
  it("places a planned event happening today in the today bucket", () => {
    const result = bucketUpcomingEvents([row()], today);
    expect(result.today.map((e) => e.entityTitle)).toEqual(["Bowling"]);
  });

  it("places events within the next week in the next7Days bucket", () => {
    const result = bucketUpcomingEvents([row({ date: "2026-09-06" })], today);
    expect(result.next7Days.map((e) => e.entityTitle)).toEqual(["Bowling"]);
  });

  it("excludes an after-the-fact log even when its date is today", () => {
    const result = bucketUpcomingEvents(
      [row({ createdAt: "2026-09-03T21:00:00.000Z" })],
      today,
    );
    expect(result.today).toEqual([]);
  });

  it("only surfaces event categories", () => {
    const result = bucketUpcomingEvents(
      [
        row({ logId: 1, category: "hang_out" }),
        row({ logId: 2, category: "appointment", entityTitle: "Dentist" }),
        row({ logId: 3, category: "movie", entityTitle: "Dune" }),
        row({ logId: 4, category: "eating_out", entityTitle: "Chipotle" }),
      ],
      today,
    );
    expect(result.today.map((e) => e.entityTitle).sort()).toEqual(["Bowling", "Dentist"]);
  });

  it("includes the seventh day and excludes the eighth", () => {
    const result = bucketUpcomingEvents(
      [
        row({ logId: 1, entityTitle: "Seventh", date: "2026-09-10" }),
        row({ logId: 2, entityTitle: "Eighth", date: "2026-09-11" }),
      ],
      today,
    );
    expect(result.next7Days.map((e) => e.entityTitle)).toEqual(["Seventh"]);
  });

  it("drops a past event", () => {
    const result = bucketUpcomingEvents([row({ date: "2026-09-02" })], today);
    expect(result.today).toEqual([]);
    expect(result.next7Days).toEqual([]);
  });

  it("orders each bucket by date, then title", () => {
    const result = bucketUpcomingEvents(
      [
        row({ logId: 1, entityTitle: "Zoo", date: "2026-09-05" }),
        row({ logId: 2, entityTitle: "Aquarium", date: "2026-09-05" }),
        row({ logId: 3, entityTitle: "Museum", date: "2026-09-04" }),
      ],
      today,
    );
    expect(result.next7Days.map((e) => e.entityTitle)).toEqual(["Museum", "Aquarium", "Zoo"]);
  });

  it("orders a day's events untimed first, then by time, then title", () => {
    const result = bucketUpcomingEvents(
      [
        row({ logId: 1, entityTitle: "Dentist", category: "appointment", time: "15:00" }),
        row({ logId: 2, entityTitle: "Zoo" }),
        row({ logId: 3, entityTitle: "Haircut", category: "appointment", time: "09:30" }),
        row({ logId: 4, entityTitle: "Aquarium" }),
      ],
      today,
    );
    expect(result.today.map((e) => [e.entityTitle, e.time])).toEqual([
      ["Aquarium", null],
      ["Zoo", null],
      ["Haircut", "09:30"],
      ["Dentist", "15:00"],
    ]);
  });

  it("carries notes and tagged people through", () => {
    const people = [{ id: 5, name: "Ada" }];
    const result = bucketUpcomingEvents([row({ notes: "bring shoes", people })], today);
    expect(result.today[0]).toMatchObject({ notes: "bring shoes", people });
  });
});
