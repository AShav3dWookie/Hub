import type { z } from "zod";
import type { AppDb } from "../db/client.js";
import type { VoiceActionName, VoiceCommandResponse, VoiceParsedBy } from "@logger/shared";
import { listLists } from "../services/listService.js";
import { addToList } from "./addToList.js";

/**
 * What voice can do, as code. Each action is one module: a name, an input schema (zod — the
 * model is shown it as a tool, and the server checks every answer against it), and `run`, which
 * checks the input against real data, writes through the same services as the app's own forms,
 * and says what it did.
 *
 * When and how each action is used is not decided here but in rules.md, which the model reads.
 * Rules can only steer between these actions: a new *kind* of write needs a new module here.
 */
export interface VoiceAction<Input extends z.ZodType = z.ZodType> {
  name: VoiceActionName;
  /** Shown to the model as the tool's description. */
  description: string;
  input: Input;
  // Method syntax, so an action with a narrower input still fits in the registry.
  run(db: AppDb, input: z.output<Input>, how: VoiceRun): VoiceCommandResponse;
}

export interface VoiceRun {
  /** The words as heard, for error messages. */
  text: string;
  parsedBy: VoiceParsedBy;
}

/** A list as the model sees it: enough to choose one by name, nothing more. */
export interface VoiceList {
  id: number;
  name: string;
}

/**
 * What the hub tells the model alongside a command, so it can fill an action's fields with real
 * ids. It is the model's view only: every action re-checks what comes back against the database.
 */
export interface VoiceContext {
  lists: VoiceList[];
}

export const VOICE_ACTIONS: readonly VoiceAction[] = [addToList];

export function findVoiceAction(name: string): VoiceAction | undefined {
  return VOICE_ACTIONS.find((a) => a.name === name);
}

export function buildVoiceContext(db: AppDb): VoiceContext {
  return { lists: listLists(db, "shopping").map(({ id, name }) => ({ id, name })) };
}
