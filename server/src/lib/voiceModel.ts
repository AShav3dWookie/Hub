import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { VOICE_ACTIONS, type VoiceAction, type VoiceContext } from "../voice/actions.js";
import { loadVoiceRules } from "../voice/rules.js";

/**
 * The only importer of `@anthropic-ai/sdk`. Everything else takes a `VoiceParser`, so tests pass
 * a fake and the rest of the server never knows how a command was understood.
 */

/**
 * Which action a command asks for, and its input as the parser gave it. The input is unchecked:
 * the caller parses it with the action's own schema before anything trusts it.
 */
export interface VoiceCall {
  action: string;
  input: unknown;
}

export type VoiceParser = (text: string, context: VoiceContext) => Promise<VoiceCall>;

/** The model couldn't give a usable answer; the caller falls back to the rules. */
export class VoiceModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceModelError";
  }
}

/**
 * An action as a tool. The JSON schema comes from the action's zod schema, so the two can't
 * disagree. zod already writes objects the way strict tool use wants them (every property
 * required, no extras); the one thing strict mode refuses is a numeric bound, and zod puts
 * "safe integer" bounds on every `.int()`, so those go. A nullable comes out as
 * `type: ["integer", "null"]`, which becomes the `anyOf` structured output documents. Keep
 * action schemas to plain types, enums and nullables — voiceModel.test.ts checks every
 * action's schema for anything else.
 */
export function toolFor(action: VoiceAction): Anthropic.Tool {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(action.input, { target: "draft-07" });
  type Node = Record<string, unknown>;
  const strict = (node: Node): Node => {
    const { type, minimum, maximum, properties, items, anyOf, ...out } = node;
    if (properties) {
      out.properties = Object.fromEntries(Object.entries(properties as Node).map(([k, v]) => [k, strict(v as Node)]));
    }
    if (items) out.items = strict(items as Node);
    if (anyOf) out.anyOf = (anyOf as Node[]).map(strict);
    if (minimum !== undefined && minimum !== Number.MIN_SAFE_INTEGER) out.minimum = minimum;
    if (maximum !== undefined && maximum !== Number.MAX_SAFE_INTEGER) out.maximum = maximum;
    if (Array.isArray(type)) return { anyOf: type.map((t: unknown) => ({ type: t })), ...out };
    return type === undefined ? out : { type, ...out };
  };
  return {
    name: action.name,
    description: action.description,
    input_schema: strict(schema) as Anthropic.Tool.InputSchema,
    strict: true,
  };
}

// Stable across calls, so the hub's data and the words go in the user turn.
function systemPrompt(): string {
  return `You are the voice control of a home hub that keeps shopping lists and a diary. Each command was transcribed by phone speech recognition, so words may be misheard.

Answer every command with exactly one tool call: the action it asks for, filled in from the command and the hub's data. The user turn gives the hub's data as JSON in <context> and the command in <command>. Only use ids that appear in the context.

Follow these rules.

<rules>
${loadVoiceRules()}
</rules>`;
}

export interface ModelVoiceParserOptions {
  apiKey: string;
  model: string;
  /** Test seam: anything with the SDK's `messages.create`. */
  client?: { messages: Pick<Anthropic["messages"], "create"> };
  /** Told each response's token usage — the manual check script reports cost with it. */
  onUsage?: (usage: Anthropic.Usage) => void;
}

export function createModelVoiceParser({
  apiKey,
  model,
  client,
  onUsage,
}: ModelVoiceParserOptions): VoiceParser {
  // A spoken command should feel instant; a slow answer is worse than the rules backup.
  const anthropic = client ?? new Anthropic({ apiKey, timeout: 10_000, maxRetries: 1 });
  const system = systemPrompt();
  const tools = VOICE_ACTIONS.map(toolFor);

  return async (text, context) => {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system,
      tools,
      // Exactly one action, always: "any" makes it pick a tool, and only one.
      tool_choice: { type: "any", disable_parallel_tool_use: true },
      messages: [
        {
          role: "user",
          content: `<context>${JSON.stringify(context)}</context>\n<command>${text}</command>`,
        },
      ],
      // Picking an action and filling it in needs little reasoning; low keeps it quick.
      output_config: { effort: "low" },
    });

    onUsage?.(response.usage);
    if (response.stop_reason === "refusal") throw new VoiceModelError("The model declined the command");
    if (response.stop_reason === "max_tokens") throw new VoiceModelError("The model's answer was cut off");

    const call = response.content.find((b) => b.type === "tool_use");
    if (!call) throw new VoiceModelError("The model didn't choose an action");
    return { action: call.name, input: call.input };
  };
}
