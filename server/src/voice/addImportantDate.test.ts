import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { handleVoiceCommand } from "../services/voiceService.js";
import { undoVoiceCommand } from "../services/voiceUndoService.js";
import { createBareEntity, findEntity } from "../services/entityService.js";
import { createEntityNote, listEntityNotes } from "../services/entityNotesService.js";
import { getUpcomingImportantDates } from "../services/importantDatesService.js";

/** Monday 2 November 2026, 10:00 in London. */
const NOW = new Date("2026-11-02T10:00:00Z");
const CLOCK = { now: NOW, timeZone: "Europe/London" };

interface Said {
  personId: number | null;
  name: string;
  tag: string;
  month: number;
  day: number;
  year: number | null;
}

describe("add_important_date", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  function setup() {
    ctx = createTestDb();
    return createBareEntity(ctx.db, "person", "Ada");
  }
  const say = (input: Said) =>
    handleVoiceCommand(ctx.db, "…", vi.fn().mockResolvedValue({ action: "add_important_date", input }), CLOCK);
  const fails = (p: Promise<unknown>) => p.catch((e: unknown) => e);
  const datesOf = (id: number) =>
    listEntityNotes(ctx.db, id)
      .filter((n) => n.category === "important_date")
      .map((n) => [n.tag, n.eventDate]);

  it("adds a birthday that then shows in upcoming dates", async () => {
    const ada = setup();
    const reply = await say({ personId: ada.id, name: "ada", tag: "birthday", month: 11, day: 5, year: null });

    expect(reply).toMatchObject({ action: "add_important_date", message: "Added Ada's Birthday, 5 November" });
    expect(datesOf(ada.id)).toEqual([["Birthday", "2026-11-05"]]);
    const upcoming = getUpcomingImportantDates(ctx.db, NOW);
    expect([...upcoming.today, ...upcoming.next7Days].map((d) => [d.entityName, d.tag])).toEqual([["Ada", "Birthday"]]);
  });

  it("keeps a year that was said, and says it back", async () => {
    const ada = setup();
    const reply = await say({ personId: ada.id, name: "Ada", tag: "Birthday", month: 3, day: 3, year: 1990 });
    expect(reply.message).toBe("Added Ada's Birthday, 3 March 1990");
    expect(datesOf(ada.id)).toEqual([["Birthday", "1990-03-03"]]);
  });

  it("stores an unsaid year as the date's next occurrence, and 29 February in a leap year", async () => {
    const ada = setup();
    await say({ personId: ada.id, name: "Ada", tag: "Anniversary", month: 3, day: 3, year: null });
    await say({ personId: ada.id, name: "Ada", tag: "New job", month: 11, day: 2, year: null });
    await say({ personId: ada.id, name: "Ada", tag: "Birthday", month: 2, day: 29, year: null });
    expect(datesOf(ada.id)).toEqual(
      expect.arrayContaining([
        ["Anniversary", "2027-03-03"],
        ["New job", "2026-11-02"],
        ["Birthday", "2028-02-29"],
      ]),
    );
  });

  it("refuses someone the hub doesn't know, and never creates them", async () => {
    setup();
    const err = await fails(say({ personId: null, name: "aida", tag: "Birthday", month: 3, day: 3, year: null }));
    expect(err).toMatchObject({ statusCode: 422, message: expect.stringMatching(/^I don't know Aida, so nothing was added/) });
    expect(findEntity(ctx.db, "person", "Aida")).toBeUndefined();
  });

  it("refuses an id that isn't a person", async () => {
    setup();
    const film = createBareEntity(ctx.db, "movie", "Dune");
    const err = await fails(say({ personId: film.id, name: "Dune", tag: "Birthday", month: 3, day: 3, year: null }));
    expect(err).toMatchObject({ statusCode: 422 });
    expect(listEntityNotes(ctx.db, film.id)).toEqual([]);
  });

  it.each([
    ["30 February", { month: 2, day: 30, year: 2026 }],
    ["a 13th month", { month: 13, day: 1, year: null }],
    ["day 0", { month: 5, day: 0, year: null }],
    ["29 February in a year without one", { month: 2, day: 29, year: 2027 }],
  ])("refuses %s, writing nothing", async (_case, date) => {
    const ada = setup();
    const err = await fails(say({ personId: ada.id, name: "Ada", tag: "Birthday", ...date }));
    expect(err).toMatchObject({ statusCode: 422, message: expect.stringMatching(/Didn't catch a date/) });
    expect(datesOf(ada.id)).toEqual([]);
  });

  it("says a date it already has rather than adding it twice", async () => {
    const ada = setup();
    createEntityNote(ctx.db, ada.id, { category: "important_date", body: "", tag: "Birthday", eventDate: "1990-03-03" });
    const reply = await say({ personId: ada.id, name: "Ada", tag: "birthday", month: 3, day: 3, year: null });
    expect(reply).toMatchObject({ note: null, commandId: null, message: "Ada's Birthday is already 3 March" });
    expect(datesOf(ada.id)).toHaveLength(1);
  });

  it("can be undone", async () => {
    const ada = setup();
    const reply = await say({ personId: ada.id, name: "Ada", tag: "Birthday", month: 3, day: 3, year: null });
    undoVoiceCommand(ctx.db, reply.commandId!, null, NOW);
    expect(datesOf(ada.id)).toEqual([]);
  });
});
