import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createModelVoiceParser, VoiceModelError, type ModelVoiceParserOptions } from "./voiceModel.js";

const LISTS = [
  { id: 1, name: "Shopping", isDefault: true },
  { id: 2, name: "M&S – Bangor", isDefault: false },
];

/** A fake `messages.create` answering with `text` and `stop_reason`. */
function fakeClient(text: string, stopReason = "end_turn") {
  const create = vi.fn().mockResolvedValue({
    stop_reason: stopReason,
    content: [{ type: "text", text }],
  });
  return { create, client: { messages: { create } } as unknown as ModelVoiceParserOptions["client"] };
}

const parserWith = (client: ModelVoiceParserOptions["client"]) =>
  createModelVoiceParser({ apiKey: "unused", model: "claude-haiku-5-5", client });

describe("createModelVoiceParser", () => {
  it("returns the list and items the model chose", async () => {
    const { client } = fakeClient(JSON.stringify({ listId: 2, items: ["Eggs", "Milk"] }));
    await expect(parserWith(client)("add eggs and milk to marks and spencer", LISTS)).resolves.toEqual({
      listId: 2,
      items: ["Eggs", "Milk"],
    });
  });

  it("asks the configured model for structured output over the user's lists and words", async () => {
    const { client, create } = fakeClient(JSON.stringify({ listId: null, items: ["Eggs"] }));
    await parserWith(client)("add eggs", LISTS);

    const request = create.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.output_config).toMatchObject({
      effort: "low",
      format: { type: "json_schema", schema: { required: ["listId", "items"] } },
    });
    const userTurn = request.messages[0].content as string;
    expect(userTurn).toContain('{"id":2,"name":"M&S – Bangor"}');
    expect(userTurn).toContain("<command>add eggs</command>");
  });

  it.each([
    ["the model declines", JSON.stringify({ listId: null, items: [] }), "refusal"],
    ["the answer is cut off", '{"listId": nu', "max_tokens"],
    ["the answer isn't JSON", "Sure! I added eggs.", "end_turn"],
    ["the answer has the wrong shape", JSON.stringify({ list: "Tesco", items: "eggs" }), "end_turn"],
  ])("throws a VoiceModelError when %s, so the caller falls back", async (_case, text, stop) => {
    const { client } = fakeClient(text, stop);
    await expect(parserWith(client)("add eggs", LISTS)).rejects.toBeInstanceOf(VoiceModelError);
  });

  it("lets a network or API failure propagate, for the caller to fall back on", async () => {
    const create = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const client = { messages: { create } } as unknown as ModelVoiceParserOptions["client"];
    await expect(parserWith(client)("add eggs", LISTS)).rejects.toThrow("ECONNREFUSED");
  });
});
