import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * The only importer of `@anthropic-ai/sdk`. Everything else takes a `VoiceParser`, so tests pass
 * a fake and the rest of the server never knows how a command was understood.
 */

/** A list as the parser sees it: enough to choose one by name, nothing more. */
export interface VoiceList {
  id: number;
  name: string;
  isDefault: boolean;
}

/** `listId` null means no list was named (or none matched) — the main list then. */
export interface ParsedVoiceCommand {
  listId: number | null;
  items: string[];
}

export type VoiceParser = (text: string, lists: VoiceList[]) => Promise<ParsedVoiceCommand>;

/** The model couldn't give a usable answer; the caller falls back to the rules. */
export class VoiceModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceModelError";
  }
}

/**
 * What the model must answer with, as a JSON schema (structured output constrains it to this)
 * and as a zod schema (which checks the answer before anything trusts it). Written out twice
 * rather than via the SDK's zod helper: that helper is built for zod v4, and the server is on
 * zod 3, so the two schema types don't line up.
 */
const COMMAND_JSON_SCHEMA = {
  type: "object",
  properties: {
    // anyOf rather than `type: ["integer", "null"]`: structured output supports the former.
    listId: { anyOf: [{ type: "integer" }, { type: "null" }] },
    items: { type: "array", items: { type: "string" } },
  },
  required: ["listId", "items"],
  additionalProperties: false,
};

const commandSchema = z.object({
  listId: z.number().int().nullable(),
  items: z.array(z.string()),
});

// Stable across calls; the per-call lists and words go in the user turn.
const SYSTEM_PROMPT = `You turn a spoken command for a shopping-list app into list entries.

The user turn gives the user's lists as JSON (id and name) and the command, transcribed by phone speech recognition, so words may be misheard.

listId: the id of the list the command names, matched by meaning — "M&S", "marks and spencer" and "marks and sparks" all name "M&S – Bangor", and "sainsburys" names "Sainsbury's – Bangor". Use null when the command names no particular list ("the shopping list", or none at all), or names a list that is not among them. Never invent an id.

items: every item the command asks to add, one entry each, written as a short list entry with its first letter capitalised ("Semi-skimmed milk"). Keep a dish or product that contains "and" together ("Fish and chips", "Salt and vinegar crisps"); split separate things ("eggs and milk" is "Eggs" and "Milk"). Keep quantities and sizes that were said ("6 eggs", "Large bin bags"). Drop filler such as "some", "please" and "can you". Fix an obvious mishearing only when the intended item is clear. If the command asks to add nothing, return an empty list.`;

export interface ModelVoiceParserOptions {
  apiKey: string;
  model: string;
  /** Test seam: anything with the SDK's `messages.create`. */
  client?: { messages: Pick<Anthropic["messages"], "create"> };
}

export function createModelVoiceParser({ apiKey, model, client }: ModelVoiceParserOptions): VoiceParser {
  // A spoken command should feel instant; a slow answer is worse than the rules backup.
  const anthropic = client ?? new Anthropic({ apiKey, timeout: 10_000, maxRetries: 1 });

  return async (text, lists) => {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `<lists>${JSON.stringify(lists.map(({ id, name }) => ({ id, name })))}</lists>\n<command>${text}</command>`,
        },
      ],
      // Picking a list and splitting a sentence needs little reasoning; low keeps it quick.
      output_config: { effort: "low", format: { type: "json_schema", schema: COMMAND_JSON_SCHEMA } },
    });

    if (response.stop_reason === "refusal") throw new VoiceModelError("The model declined the command");
    if (response.stop_reason === "max_tokens") throw new VoiceModelError("The model's answer was cut off");

    const answer = response.content.find((b) => b.type === "text")?.text ?? "";
    let json: unknown;
    try {
      json = JSON.parse(answer);
    } catch {
      throw new VoiceModelError("The model's answer wasn't JSON");
    }
    const parsed = commandSchema.safeParse(json);
    if (!parsed.success) throw new VoiceModelError("The model's answer didn't match the expected shape");
    return parsed.data;
  };
}
