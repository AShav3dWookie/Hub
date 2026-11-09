import type { AppDb } from "../db/client.js";
import { VoiceModelError, type VoiceCall, type VoiceParser } from "../lib/voiceModel.js";
import { buildVoiceContext, findVoiceAction, type VoiceAction, type VoiceClock } from "../voice/actions.js";
import { localTime } from "../lib/localClock.js";
import { AppError } from "../lib/errors.js";
import type { VoiceCommandResponse, VoiceRecord } from "@logger/shared";
import { recordVoiceCommand } from "./voiceUndoService.js";
import { writeLog } from "./serverLogService.js";

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
 * The model does the understanding. Without one, or when it fails — a timeout, a refusal, an
 * answer that doesn't fit — the command is refused with a 503 and nothing is saved: a guess
 * (the rules backup this replaced put "an appointment for a haircut on the 24th…" on the
 * shopping list) is worse than asking again. Dates and times are local to `clock.timeZone`
 * (`NOTIFY_TIMEZONE`). The server, not the parser, decides what is written: the action checks
 * its input against real data before it touches anything.
 */
export async function handleVoiceCommand(
  db: AppDb,
  text: string,
  parseWithModel: VoiceParser | null,
  clock: VoiceClock,
  /** The device token that sent it, or null for a signed-in browser. Only it may undo. */
  deviceId: number | null = null,
): Promise<VoiceCommandResponse> {
  const started = Date.now();
  // Everything the log needs to answer "why did it do that?" (docs/logs.md).
  const trace: Record<string, unknown> = { text, device: deviceId };
  const log = (level: "info" | "warn" | "error", outcome: string) =>
    writeLog(db, {
      level,
      source: "voice",
      message: `"${text}" → ${outcome}`,
      data: { ...trace, ms: Date.now() - started },
    });

  try {
    const context = buildVoiceContext(db, clock);

    if (!parseWithModel) {
      trace.modelError = "no model configured (ANTHROPIC_API_KEY unset)";
      throw new AppError(503, "Voice commands need Claude, and the hub has no Anthropic key. Nothing was saved.");
    }
    let call: { action: VoiceAction; input: unknown };
    let answer: VoiceCall | null = null;
    try {
      answer = await parseWithModel(text, context);
      call = checkCall(answer);
    } catch (err) {
      trace.modelError = (err as Error).message;
      // An answer that failed its schema is the interesting part of a misunderstanding.
      if (answer) trace.modelAnswer = answer;
      throw new AppError(503, "Couldn't get through to Claude, so nothing was saved. Try again in a moment.");
    }
    trace.action = call.action.name;
    trace.input = call.input;

    const { dateISO: today, minutes: nowMinutes } = localTime(clock.now, clock.timeZone);
    const action = call.action;
    const input = call.input;
    const done = db.transaction(() => {
      const created: VoiceRecord[] = [];
      const record = (r: VoiceRecord) => void created.push(r);
      const reply = action.run(db, input, { text, today, nowMinutes, record });
      const commandId =
        created.length > 0 ? recordVoiceCommand(db, { action: action.name, created, deviceId, now: clock.now }) : null;
      const response = { ...reply, parsedBy: "model", commandId } as VoiceCommandResponse;
      return response;
    });
    trace.commandId = done.commandId;
    log("info", `${action.name}: ${done.message}`);
    return done;
  } catch (err) {
    const known = err instanceof AppError;
    if (!known) trace.stack = (err as Error)?.stack ?? null;
    // A 503 is the hub unable to take any command (no key, the model down): worth seeing first.
    const level = known && err.statusCode !== 503 ? "warn" : "error";
    log(level, `${known ? `refused (${err.statusCode})` : "failed"}: ${(err as Error)?.message ?? String(err)}`);
    throw err;
  }
}
