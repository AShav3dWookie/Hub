import { describe, it, expect } from "vitest";
import { createModelVoiceParser } from "./voiceModel.js";

/**
 * The real model on real phrases — the one test that can tell whether the prompt works.
 *
 * Skipped unless ANTHROPIC_API_KEY is set, so CI and an ordinary `npm test` never call the API.
 * Run it after changing the prompt or VOICE_MODEL:
 *
 *   ANTHROPIC_API_KEY=sk-ant-… npx vitest run voiceModel.live
 *
 * About a dozen requests to Haiku: well under a penny.
 */
const apiKey = process.env.ANTHROPIC_API_KEY;

const LISTS = [
  { id: 1, name: "Shopping", isDefault: true },
  { id: 2, name: "M&S – Bangor", isDefault: false },
  { id: 3, name: "Sainsbury's – Bangor", isDefault: false },
];

describe.skipIf(!apiKey)("voice parser against the real model", () => {
  const parse = createModelVoiceParser({
    apiKey: apiKey ?? "",
    model: process.env.VOICE_MODEL || "claude-haiku-5-5",
  });
  const lower = (items: string[]) => items.map((i) => i.toLowerCase());

  it.each([
    ["add eggs and milk to marks and spencer", 2, ["eggs", "milk"]],
    ["put fish and chips on the shopping list", null, ["fish and chips"]],
    ["add 6 eggs to sainsburys", 3, ["6 eggs"]],
    ["can you add some bin bags please", null, ["bin bags"]],
    ["add salt and vinegar crisps and bread to m and s", 2, ["salt and vinegar crisps", "bread"]],
    ["add bread to the lidl list", null, ["bread"]],
  ] as const)("%s", async (command, listId, items) => {
    const result = await parse(command, LISTS);
    expect(result.listId).toBe(listId);
    expect(lower(result.items)).toEqual(items);
  }, 30_000);

  it("finds nothing to add in a command that adds nothing", async () => {
    expect((await parse("what's on my list", LISTS)).items).toEqual([]);
  }, 30_000);
});
