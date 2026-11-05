import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { handleVoiceCommand } from "../services/voiceService.js";
import { createLog as createLogEntry, getLogById } from "../services/logService.js";
import { createBareEntity, findEntity } from "../services/entityService.js";
import { getChanges } from "../services/syncService.js";
import { logs } from "../db/schema.js";
import type { VoiceParser } from "../lib/voiceModel.js";
import type { CreateLogInput } from "./createLog.js";

/** Monday 2 November 2026, 10:00 in London (GMT). */
const CLOCK = { now: new Date("2026-11-02T10:00:00Z"), timeZone: "Europe/London" };

const UNSAID: Omit<CreateLogInput, "category" | "title" | "date"> = {
  time: null,
  autoDelete: null,
  rating: null,
  releaseYear: null,
  author: null,
  notes: null,
  people: [],
};

const fails = (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe("create_log", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
  });

  /** Say `text` with the model answering create_log with `input` (an appointment by default). */
  function say(input: Partial<CreateLogInput> & Pick<CreateLogInput, "title" | "date">, text = "…") {
    const parser: VoiceParser = vi.fn().mockResolvedValue({
      action: "create_log",
      input: { category: "appointment", ...UNSAID, ...input },
    });
    return handleVoiceCommand(ctx.db, text, parser, CLOCK);
  }
  // Counted in the table, not through getChanges: the change feed sweeps passed auto-delete
  // appointments against the real clock, so CLOCK's 2 Nov ones vanished from it on 3 Nov.
  const logCount = () => ctx.db.select({ id: logs.id }).from(logs).all().length;

  it("adds a timed appointment and says exactly what was saved", async () => {
    ctx = createTestDb();
    const reply = await say({ title: "dentist", date: "2026-11-03", time: "15:00" }, "dentist next tuesday at 3");

    expect(reply).toMatchObject({
      action: "create_log",
      parsedBy: "model",
      message: "Added Dentist, Tue 3 Nov 15:00",
      log: { category: "appointment", title: "Dentist", date: "2026-11-03", time: "15:00" },
    });
    if (reply.action !== "create_log") throw new Error("expected create_log");
    expect(getLogById(ctx.db, reply.log.id)).toMatchObject({ date: "2026-11-03", time: "15:00", autoDelete: true });
  });

  it("adds an untimed appointment, kept when asked, with its notes", async () => {
    ctx = createTestDb();
    const reply = await say({ title: "Haircut", date: "2026-11-14", autoDelete: false, notes: " ask for Sam " });
    expect(reply.message).toBe("Added Haircut, Sat 14 Nov");
    if (reply.action !== "create_log") throw new Error("expected create_log");
    expect(getLogById(ctx.db, reply.log.id)).toMatchObject({ time: null, autoDelete: false, notes: "ask for Sam" });
  });

  it("names the year when it isn't this one", async () => {
    ctx = createTestDb();
    expect((await say({ title: "Passport", date: "2027-01-05" })).message).toBe("Added Passport, Tue 5 Jan 2027");
  });

  it("files a second appointment under the same entry", async () => {
    ctx = createTestDb();
    const first = await say({ title: "Dentist", date: "2026-11-03" });
    const second = await say({ title: "dentist", date: "2026-12-01" });
    if (first.action !== "create_log" || second.action !== "create_log") throw new Error("expected create_log");
    expect(second.log.entityId).toBe(first.log.entityId);
  });

  it("accepts today, and a time later today", async () => {
    ctx = createTestDb();
    await say({ title: "Bins", date: "2026-11-02" });
    await say({ title: "Physio", date: "2026-11-02", time: "10:01" });
    expect(logCount()).toBe(2);
  });

  it.each([
    ["a day already gone", { date: "2026-11-01" }],
    ["a time already gone today", { date: "2026-11-02", time: "09:00" }],
    ["the time it is now", { date: "2026-11-02", time: "10:00" }],
  ])("refuses an appointment for %s, writing nothing", async (_case, when) => {
    ctx = createTestDb();
    const err = await fails(say({ title: "Dentist", ...when }));
    expect(err).toMatchObject({ statusCode: 422, message: expect.stringMatching(/is in the past/) });
    expect(logCount()).toBe(0);
  });

  it.each([
    ["a date that doesn't exist", { date: "2026-02-30" }, /Didn't catch a date/],
    ["a date that isn't a date", { date: "next tuesday" }, /Didn't catch a date/],
    ["a time that isn't HH:MM", { date: "2026-11-03", time: "3pm" }, /Didn't catch a time/],
    ["no title", { date: "2026-11-03", title: "  " }, /Didn't catch what to add/],
  ])("refuses %s, writing nothing", async (_case, fields, message) => {
    ctx = createTestDb();
    const err = await fails(say({ title: "Dentist", ...fields }));
    expect(err).toMatchObject({ statusCode: 422, message: expect.stringMatching(message) });
    expect(logCount()).toBe(0);
  });

  it("works for any loggable category, dropping fields it doesn't have and saying what it was", async () => {
    ctx = createTestDb();
    const book = await say({
      category: "book",
      title: "Dune",
      date: "2026-11-02",
      time: "15:00",
      rating: 5,
      author: "Frank Herbert",
    });
    expect(book).toMatchObject({ message: "Added Dune (Book), 2026", log: { date: "2026-01-01", time: null } });
    if (book.action !== "create_log") throw new Error("expected create_log");
    expect(getLogById(ctx.db, book.log.id)).toMatchObject({ rating: 5, autoDelete: false });

    const meal = await say({ category: "eating_out", title: "Dylan's", date: "2026-10-30", rating: 9 });
    expect(meal.message).toBe("Added Dylan's (Eating Out), Fri 30 Oct");
    if (meal.action !== "create_log") throw new Error("expected create_log");
    expect(getLogById(ctx.db, meal.log.id).rating).toBeNull();
  });
});

describe("create_log with people", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  function people() {
    ctx = createTestDb();
    const ada = createBareEntity(ctx.db, "person", "Ada");
    const zoe = createBareEntity(ctx.db, "person", "Zoe");
    return { ada, zoe };
  }
  const say = (input: Partial<CreateLogInput>) =>
    handleVoiceCommand(
      ctx.db,
      "…",
      vi.fn().mockResolvedValue({
        action: "create_log",
        input: { category: "eating_out", title: "Dylan's", date: "2026-11-02", ...UNSAID, ...input },
      }),
      CLOCK,
    );
  const taggedOn = async (reply: Awaited<ReturnType<typeof say>>) => {
    if (reply.action !== "create_log") throw new Error("expected create_log");
    return getLogById(ctx.db, reply.log.id).people.map((p) => p.name);
  };

  it("tags the people the model matched, and says who", async () => {
    const { ada, zoe } = people();
    const reply = await say({ people: [{ id: zoe.id, name: "zo" }, { id: ada.id, name: "Ada" }] });
    expect(reply.message).toBe("Added Dylan's (Eating Out) with Zoe and Ada, Mon 2 Nov");
    expect(await taggedOn(reply)).toEqual(expect.arrayContaining(["Ada", "Zoe"]));
  });

  it("leaves off a name it doesn't know, says so, and never creates the person", async () => {
    const { ada } = people();
    const reply = await say({
      category: "hang_out",
      title: "Bowling",
      people: [{ id: ada.id, name: "Ada" }, { id: null, name: "aida" }],
    });
    expect(reply.message).toBe("Added Bowling (Hang Out) with Ada, Mon 2 Nov. I don't know Aida, so they weren't tagged");
    expect(await taggedOn(reply)).toEqual(["Ada"]);
    expect(findEntity(ctx.db, "person", "Aida")).toBeUndefined();
  });

  it("treats an id that isn't a person as unknown", async () => {
    people();
    const film = createLogEntry(ctx.db, { category: "movie", title: "Dune", rating: null, date: "2026-01-01", notes: null, people: [] });
    const reply = await say({ people: [{ id: film.entityId, name: "Dune" }, { id: 9999, name: "Bob" }] });
    expect(reply.message).toBe("Added Dylan's (Eating Out), Mon 2 Nov. I don't know Dune and Bob, so they weren't tagged");
    expect(await taggedOn(reply)).toEqual([]);
  });

  it("tags someone named twice once", async () => {
    const { ada } = people();
    const reply = await say({ people: [{ id: ada.id, name: "Ada" }, { id: ada.id, name: "ada" }] });
    expect(await taggedOn(reply)).toEqual(["Ada"]);
  });

  it("ignores people for a category that has none", async () => {
    const { ada } = people();
    const reply = await say({ category: "appointment", title: "Dentist", date: "2026-11-03", people: [{ id: ada.id, name: "Ada" }] });
    expect(reply.message).toBe("Added Dentist, Tue 3 Nov");
    expect(await taggedOn(reply)).toEqual([]);
  });
});

describe("not_supported", () => {
  it("writes nothing and says what it can't do", async () => {
    const ctx = createTestDb();
    try {
      const parser: VoiceParser = vi.fn().mockResolvedValue({
        action: "not_supported",
        input: { reason: "answering questions." },
      });
      const err = await fails(handleVoiceCommand(ctx.db, "what's on tomorrow", parser, CLOCK));
      expect(err).toMatchObject({ statusCode: 422, message: "I can't do that by voice (answering questions)." });
      expect(getChanges(ctx.db).changes.logs).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});
