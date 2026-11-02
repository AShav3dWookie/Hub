import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createModelVoiceParser, toolFor, VoiceModelError, type ModelVoiceParserOptions } from "./voiceModel.js";
import { VOICE_ACTIONS } from "../voice/actions.js";
import { addToList } from "../voice/addToList.js";

const CONTEXT = {
  today: "2026-11-02",
  weekday: "Monday",
  time: "10:00",
  timeZone: "Europe/London",
  comingDays: ["Tuesday 2026-11-03"],
  people: [{ id: 9, name: "Zoe" }],
  lists: [
    { id: 1, name: "Shopping" },
    { id: 2, name: "M&S – Bangor" },
  ],
};

/** A fake `messages.create` answering with `content` and `stop_reason`. */
function fakeClient(content: unknown[], stopReason = "tool_use") {
  const create = vi.fn().mockResolvedValue({ stop_reason: stopReason, content, usage: {} });
  return { create, client: { messages: { create } } as unknown as ModelVoiceParserOptions["client"] };
}

const toolUse = (name: string, input: unknown) => ({ type: "tool_use", id: "toolu_1", name, input });

const parserWith = (client: ModelVoiceParserOptions["client"]) =>
  createModelVoiceParser({ apiKey: "unused", model: "claude-haiku-5-5", client });

describe("createModelVoiceParser", () => {
  it("returns the action the model called and its input, unchecked", async () => {
    const { client } = fakeClient([toolUse("add_to_list", { listId: 2, items: ["Eggs", "Milk"] })]);
    await expect(parserWith(client)("add eggs and milk to marks and spencer", CONTEXT)).resolves.toEqual({
      action: "add_to_list",
      input: { listId: 2, items: ["Eggs", "Milk"] },
    });
  });

  it("offers every action as a tool and makes the model call exactly one", async () => {
    const { client, create } = fakeClient([toolUse("add_to_list", { listId: null, items: ["Eggs"] })]);
    await parserWith(client)("add eggs", CONTEXT);

    const request = create.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.tools?.map((t) => (t as Anthropic.Tool).name)).toEqual(VOICE_ACTIONS.map((a) => a.name));
    expect(request.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
    expect(request.output_config).toEqual({ effort: "low" });
  });

  it("puts the rules in the system prompt and the hub's data and the words in the user turn", async () => {
    const { client, create } = fakeClient([toolUse("add_to_list", { listId: null, items: ["Eggs"] })]);
    await parserWith(client)("add eggs", CONTEXT);

    const request = create.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(request.system).toContain("<rules>\n# Voice rules");
    const userTurn = request.messages[0].content as string;
    expect(userTurn).toContain('{"id":2,"name":"M&S – Bangor"}');
    expect(userTurn).toContain("<command>add eggs</command>");
  });

  it.each([
    ["the model declines", [], "refusal"],
    ["the answer is cut off", [toolUse("add_to_list", {})], "max_tokens"],
    ["the model answers in words instead of calling an action", [{ type: "text", text: "Sure!" }], "end_turn"],
  ])("throws a VoiceModelError when %s, so the caller falls back", async (_case, content, stop) => {
    const { client } = fakeClient(content, stop);
    await expect(parserWith(client)("add eggs", CONTEXT)).rejects.toBeInstanceOf(VoiceModelError);
  });

  it("lets a network or API failure propagate, for the caller to fall back on", async () => {
    const create = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const client = { messages: { create } } as unknown as ModelVoiceParserOptions["client"];
    await expect(parserWith(client)("add eggs", CONTEXT)).rejects.toThrow("ECONNREFUSED");
  });
});

describe("toolFor", () => {
  it("turns an action's zod schema into a strict tool schema", () => {
    expect(toolFor(addToList)).toEqual({
      name: "add_to_list",
      description: "Add items to one of the shopping lists.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["listId", "items"],
        properties: {
          listId: {
            anyOf: [{ type: "integer" }, { type: "null" }],
            description: expect.stringContaining("Never invent an id"),
          },
          items: { type: "array", items: { type: "string" }, description: expect.any(String) },
        },
      },
    });
  });

  it.each(VOICE_ACTIONS.map((a) => [a.name, a] as const))(
    "%s: fits strict tool use (every property required, no extras, no bounds)",
    (_name, action) => {
      const visit = (schema: Record<string, unknown>) => {
        for (const bound of ["minimum", "maximum", "minLength", "maxLength", "multipleOf", "$schema"]) {
          expect(schema).not.toHaveProperty(bound);
        }
        if (schema.type === "object") {
          expect(schema.additionalProperties).toBe(false);
          expect(schema.required).toEqual(Object.keys(schema.properties as object));
        }
        for (const value of Object.values(schema)) {
          if (value && typeof value === "object") visit(value as Record<string, unknown>);
        }
      };
      visit(toolFor(action).input_schema as Record<string, unknown>);
    },
  );
});
