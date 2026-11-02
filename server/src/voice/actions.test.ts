import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { createList } from "../services/listService.js";
import { VOICE_ACTIONS, buildVoiceContext, findVoiceAction } from "./actions.js";
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

  it("tells the model about the shopping lists by id and name only", () => {
    ctx = createTestDb();
    const ms = createList(ctx.db, { name: "M&S – Bangor" });
    expect(buildVoiceContext(ctx.db).lists).toEqual([
      { id: expect.any(Number), name: "Shopping" },
      { id: ms.id, name: "M&S – Bangor" },
    ]);
  });
});
