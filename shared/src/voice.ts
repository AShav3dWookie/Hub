/**
 * `POST /api/voice` — a spoken command, already turned into text by the phone, applied to the
 * lists. Only adding is supported so far; `action` is in the response so removing can follow
 * without changing its shape.
 */

/** Longer than any sensible spoken command; stops a stuck microphone sending a transcript. */
export const VOICE_TEXT_MAX_LENGTH = 500;

export interface VoiceCommandRequest {
  text: string;
}

/**
 * Which parser understood the command. `"rules"` means the model couldn't be reached and the
 * simple backup was used, which never splits "eggs and milk" into two items — worth a glance.
 */
export type VoiceParsedBy = "model" | "rules";

export interface VoiceCommandResponse {
  action: "add";
  list: { id: number; name: string };
  /** Items newly put on the list. */
  added: string[];
  /** Items the list already had, so nothing was written for them. */
  alreadyOnList: string[];
  parsedBy: VoiceParsedBy;
  /** One line for the device to show, e.g. "Added eggs, milk to Tesco". */
  message: string;
}
