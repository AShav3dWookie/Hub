import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createList } from "../services/listService.js";
import { createBareEntity } from "../services/entityService.js";
import { VOICE_ACTIONS, buildVoiceContext, describeClock, findVoiceAction } from "./actions.js";
import { loadVoiceRules } from "./rules.js";

describe("voice actions", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  it("have unique names, each findable by name", () => {
    const names = VOICE_ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const action of VOICE_ACTIONS) expect(findVoiceAction(action.name)).toBe(action);
    expect(findVoiceAction("drop_tables")).toBeUndefined();
  });

  it.each(VOICE_ACTIONS.map((a) => [a.name]))("%s has a section in the rules", (name) => {
    expect(loadVoiceRules()).toMatch(new RegExp(String.raw`^## .*\b${name}\b`, "m"));
  });

  it("lists the coming five weeks by weekday, from tomorrow", () => {
    const { comingDays } = describeClock({ now: new Date("2026-11-02T10:00:00Z"), timeZone: "Europe/London" });
    expect(comingDays).toHaveLength(35);
    expect(comingDays.slice(0, 2)).toEqual(["Tuesday 2026-11-03", "Wednesday 2026-11-04"]);
    expect(comingDays.at(-1)).toBe("Monday 2026-12-07");
  });

  it("tells the model about everyone who can be tagged, by name", () => {
    ctx = createTestDb();
    const zoe = createBareEntity(ctx.db, "person", "Zoe");
    const ada = createBareEntity(ctx.db, "person", "Ada");
    createBareEntity(ctx.db, "movie", "Dune");
    expect(buildVoiceContext(ctx.db, { now: new Date(), timeZone: "Europe/London" }).people).toEqual([
      { id: ada.id, name: "Ada" },
      { id: zoe.id, name: "Zoe" },
    ]);
  });

  it("tells the model about the shopping lists by id and name only", () => {
    ctx = createTestDb();
    const ms = createList(ctx.db, { name: "M&S – Bangor" });
    expect(buildVoiceContext(ctx.db, { now: new Date(), timeZone: "Europe/London" }).lists).toEqual([
      { id: expect.any(Number), name: "Shopping" },
      { id: ms.id, name: "M&S – Bangor" },
    ]);
  });
});
