import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import { createModelVoiceParser, type VoiceParser } from "../lib/voiceModel.js";
import { handleVoiceCommand } from "../services/voiceService.js";
import { voiceCommandSchema } from "../lib/validation.js";

/**
 * `POST /api/voice { text }` — see docs/voice.md.
 *
 * `parser` undefined means "work it out from config", done once on first use: the real model
 * when an API key is set, otherwise none (rules only). Tests pass a fake, or null.
 */
export function createVoiceRouter(db: AppDb, parser?: VoiceParser | null): Router {
  const router = Router();

  let resolved = parser;
  const getParser = (): VoiceParser | null => {
    if (resolved === undefined) {
      resolved = config.anthropicApiKey
        ? createModelVoiceParser({ apiKey: config.anthropicApiKey, model: config.voiceModel })
        : null;
    }
    return resolved;
  };

  // Express 4 doesn't forward a rejected promise, so the async work is chained to next.
  router.post("/", (req, res, next) => {
    const { text } = voiceCommandSchema.parse(req.body);
    handleVoiceCommand(db, text, getParser())
      .then((result) => res.json(result))
      .catch(next);
  });

  return router;
}
