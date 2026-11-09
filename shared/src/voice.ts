import type { LoggableCategory } from "./categories.js";

/**
 * `POST /api/voice` — a spoken command, already turned into text by the phone, applied to the
 * hub. The server picks one of a fixed set of **actions** (server/src/voice/) for it, steered by
 * the rules in server/src/voice/rules.md; the response's `action` says which ran, and the rest
 * of it is that action's detail.
 */

/** Longer than any sensible spoken command; stops a stuck microphone sending a transcript. */
export const VOICE_TEXT_MAX_LENGTH = 500;

export interface VoiceCommandRequest {
  text: string;
}

/**
 * Which parser understood the command. Only ever "model" since the rules backup was removed
 * (1.6.0): a command the model can't take is refused instead. Kept on the reply because
 * companion apps up to 1.5 read it.
 */
export type VoiceParsedBy = "model";

/**
 * `GET /api/voice/status` — the companion app's "Test connection". Proves the token works
 * without adding anything to a list, and says whether voice commands can be understood.
 */
export interface VoiceStatusResponse {
  /** The device the token belongs to; null when called from a signed-in browser. */
  device: string | null;
  /** "model" when the server has an Anthropic key; "none" when voice commands will be refused. */
  parser: "model" | "none";
}

/** What voice can do. Each one is a module in server/src/voice/. */
export type VoiceActionName = "add_to_list" | "create_log" | "add_important_date" | "not_supported";

/** One row a voice command created, as recorded for Undo. */
export type VoiceRecord =
  | { kind: "listItem"; listId: number; id: number }
  | { kind: "log"; id: number }
  | { kind: "note"; id: number }
  /** Only an entity the command itself created; undo removes it if nothing else uses it. */
  | { kind: "entity"; id: number };

/** How long a voice command can be undone from the device that said it. */
export const VOICE_UNDO_WINDOW_MS = 5 * 60_000;

interface VoiceReplyBase {
  action: VoiceActionName;
  parsedBy: VoiceParsedBy;
  /**
   * For `DELETE /api/voice/commands/:id` (Undo), within `VOICE_UNDO_WINDOW_MS`. Null when the
   * command saved nothing (every item was already on the list).
   */
  commandId: number | null;
  /** One line for the device to show, e.g. "Added Eggs and Milk to Tesco". */
  message: string;
}

export interface AddToListReply extends VoiceReplyBase {
  action: "add_to_list";
  list: { id: number; name: string };
  /** Items newly put on the list. */
  added: string[];
  /** Items the list already had, so nothing was written for them. */
  alreadyOnList: string[];
}

export interface CreateLogReply extends VoiceReplyBase {
  action: "create_log";
  log: {
    id: number;
    entityId: number;
    category: LoggableCategory;
    title: string;
    date: string;
    time: string | null;
    /** Who was tagged. Names the hub didn't know are left off and named in `message`. */
    people: { id: number; name: string }[];
  };
}

/**
 * Discriminated by `action`. A device needs only `action` and `message`. (`not_supported` never
 * answers 200: it is a 422 carrying the reason.)
 */
export interface AddImportantDateReply extends VoiceReplyBase {
  action: "add_important_date";
  /** Null when the person already had this date, so nothing was written. */
  note: { id: number; entityId: number; tag: string; eventDate: string } | null;
}

export type VoiceCommandResponse = AddToListReply | CreateLogReply | AddImportantDateReply;
