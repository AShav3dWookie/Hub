import { describe, it, expect } from "vitest";
import { expiredAppointmentLogIds, todayISO } from "./sweep.js";
import { makeEntity, makeLog, makePerson, resetFixtureCounters } from "../test/seedLocalDb.js";

describe("sweep", () => {
  it("todayISO is the UTC calendar day", () => {
    expect(todayISO(new Date("2026-08-31T23:30:00.000Z"))).toBe("2026-08-31");
    expect(todayISO(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });

  it("flags only past-dated auto-delete appointment logs", () => {
    resetFixtureCounters();
    const appt = makeEntity({ category: "appointment", title: "Appts" });
    const movie = makeEntity({ category: "movie", title: "Heat" });
    const entityById = new Map([appt, movie].map((e) => [e.id, e]));

    const pastAuto = makeLog({ entityId: appt.id, autoDelete: true, date: "2026-01-01" });
    const futureAuto = makeLog({ entityId: appt.id, autoDelete: true, date: "2999-01-01" });
    const pastNoAuto = makeLog({ entityId: appt.id, autoDelete: false, date: "2026-01-01" });
    const pastMovie = makeLog({ entityId: movie.id, autoDelete: true, date: "2026-01-01" });

    const expired = expiredAppointmentLogIds(
      [pastAuto, futureAuto, pastNoAuto, pastMovie],
      entityById,
      new Date("2026-06-01T12:00:00.000Z"),
    );
    expect([...expired]).toEqual([pastAuto.id]);
  });

  it("does not flag an appointment dated today", () => {
    resetFixtureCounters();
    const appt = makeEntity({ category: "appointment", title: "Appts" });
    const person = makePerson("Sam");
    const entityById = new Map([appt, person].map((e) => [e.id, e]));
    const todayLog = makeLog({ entityId: appt.id, autoDelete: true, date: "2026-06-01" });

    const expired = expiredAppointmentLogIds(
      [todayLog],
      entityById,
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(expired.size).toBe(0);
  });
});
