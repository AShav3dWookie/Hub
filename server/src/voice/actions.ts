import type { z } from "zod";
import type { AppDb } from "../db/client.js";
import type { VoiceActionName, VoiceCommandResponse, VoiceParsedBy, VoiceRecord } from "@logger/shared";
import { listLists } from "../services/listService.js";
import { addDaysISO, localTime } from "../lib/localClock.js";
import { addToList } from "./addToList.js";
import { createLog } from "./createLog.js";
import { notSupported } from "./notSupported.js";

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
  /**
   * Must `how.record` every row it creates, so Undo can take exactly those away. The reply's
   * `commandId` is filled in by the caller once the command is saved.
   */
  // Method syntax, so an action with a narrower input still fits in the registry.
  run(db: AppDb, input: z.output<Input>, how: VoiceRun): VoiceReplyWithoutId;
}

export interface VoiceRun {
  /** The words as heard, for error messages. */
  text: string;
  parsedBy: VoiceParsedBy;
  /** Local date and minutes past midnight when the command arrived, for "not in the past". */
  today: string;
  nowMinutes: number;
  /** Note a row this command created, for Undo. */
  record(created: VoiceRecord): void;
}

/** An action's reply before the command has an id. */
export type VoiceReplyWithoutId = VoiceCommandResponse extends infer R
  ? R extends VoiceCommandResponse
    ? Omit<R, "commandId">
    : never
  : never;

/** When a command arrives, and the zone its dates and times mean (`NOTIFY_TIMEZONE`). */
export interface VoiceClock {
  now: Date;
  timeZone: string;
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
  /** Local `YYYY-MM-DD`, its weekday and the time, so "next Tuesday at 3" can become a date. */
  today: string;
  weekday: string;
  time: string;
  timeZone: string;
  /**
   * The next five weeks, "Tuesday 2026-11-03" from tomorrow on. A model is far better at finding
   * "the first Tuesday" in a list than at counting days, which it got wrong in voice:check.
   */
  comingDays: string[];
  lists: VoiceList[];
}

/** How far ahead `comingDays` runs. */
export const COMING_DAYS = 35;

export const VOICE_ACTIONS: readonly VoiceAction[] = [addToList, createLog, notSupported];

export function findVoiceAction(name: string): VoiceAction | undefined {
  return VOICE_ACTIONS.find((a) => a.name === name);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildVoiceContext(db: AppDb, clock: VoiceClock): VoiceContext {
  return { ...describeClock(clock), lists: listLists(db, "shopping").map(({ id, name }) => ({ id, name })) };
}

/** The date-and-time half of the context: no data, so voice:check builds it the same way. */
export function describeClock({ now, timeZone }: VoiceClock): Omit<VoiceContext, "lists"> {
  const { dateISO, minutes } = localTime(now, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekdayOf = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return {
    today: dateISO,
    weekday: weekdayOf(dateISO),
    time: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
    timeZone,
    comingDays: Array.from({ length: COMING_DAYS }, (_, i) => {
      const iso = addDaysISO(dateISO, i + 1);
      return `${weekdayOf(iso)} ${iso}`;
    }),
  };
}
