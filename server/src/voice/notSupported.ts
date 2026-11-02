import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { VoiceAction } from "./actions.js";

const input = z.object({
  reason: z.string().describe('Why, in a few words, e.g. "answering questions" or "removing things".'),
});

/**
 * The model must always call an action, so this is the one for a command no action can do: a
 * question, a removal, an edit. It writes nothing and answers with a 422 the device shows,
 * rather than letting the command land somewhere it doesn't belong (a question on the shopping
 * list).
 */
export const notSupported: VoiceAction<typeof input> = {
  name: "not_supported",
  description: "Use when the command asks for something none of the other actions can do. Saves nothing.",
  input,
  run(_db, { reason }) {
    const why = reason.trim().replace(/[.!]+$/, "");
    throw new AppError(422, `I can't do that by voice${why ? ` (${why})` : ""}.`);
  },
};
