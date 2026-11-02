import type { AppDb } from "../db/client.js";
import { parseWithRules } from "../lib/voiceRules.js";
import { VoiceModelError, type VoiceCall, type VoiceParser } from "../lib/voiceModel.js";
import { buildVoiceContext, findVoiceAction, type VoiceAction } from "../voice/actions.js";
import { addToList } from "../voice/addToList.js";
import type { VoiceCommandResponse, VoiceParsedBy } from "@logger/shared";

/** The parser's answer, checked: a real action, and input that fits that action's schema. */
function checkCall(call: VoiceCall): { action: VoiceAction; input: unknown } {
  const action = findVoiceAction(call.action);
  if (!action) throw new VoiceModelError(`The model chose an unknown action "${call.action}"`);
  const input = action.input.safeParse(call.input);
  if (!input.success) throw new VoiceModelError(`The model's ${action.name} didn't match its schema`);
  return { action, input: input.data };
}

/**
 * Apply a spoken command to the hub: the parser picks one action (server/src/voice/) and fills
 * it in, and the action does the writing.
 *
 * The model (when there is one) does the understanding; any failure — no key, a timeout, a
 * refusal, an unusable answer — falls back to the rules parser, so a command is never lost.
 * Either way the server, not the parser, decides what is written: the action checks its input
 * against real data before it touches anything.
 */
export async function handleVoiceCommand(
  db: AppDb,
  text: string,
  parseWithModel: VoiceParser | null,
): Promise<VoiceCommandResponse> {
  const context = buildVoiceContext(db);

  let call: { action: VoiceAction; input: unknown } | null = null;
  let parsedBy: VoiceParsedBy = "model";
  if (parseWithModel) {
    try {
      call = checkCall(await parseWithModel(text, context));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[voice] model parser failed, using the rules backup: ${(err as Error).message}`);
    }
  }
  if (!call) {
    call = { action: addToList, input: parseWithRules(text, context.lists) };
    parsedBy = "rules";
  }

  return call.action.run(db, call.input, { text, parsedBy });
}
