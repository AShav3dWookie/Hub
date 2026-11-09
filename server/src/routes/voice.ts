import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import { createModelVoiceParser, type VoiceParser } from "../lib/voiceModel.js";
import { handleVoiceCommand } from "../services/voiceService.js";
import { undoVoiceCommand } from "../services/voiceUndoService.js";
import { idParam } from "../lib/params.js";
import { voiceCommandSchema } from "../lib/validation.js";
import type { DeviceTokenDTO, VoiceStatusResponse } from "@logger/shared";

/**
 * `POST /api/voice { text }` — see docs/voice.md.
 *
 * `parser` undefined means "work it out from config", done once on first use: the real model
 * when an API key is set, otherwise none (voice commands are refused). Tests pass a fake, or null.
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

  router.get("/status", (_req, res) => {
    const body: VoiceStatusResponse = {
      device: (res.locals.device as DeviceTokenDTO | undefined)?.name ?? null,
      parser: getParser() ? "model" : "none",
    };
    res.json(body);
  });

  // Express 4 doesn't forward a rejected promise, so the async work is chained to next.
  router.post("/", (req, res, next) => {
    const { text } = voiceCommandSchema.parse(req.body);
    const deviceId = (res.locals.device as DeviceTokenDTO | undefined)?.id ?? null;
    handleVoiceCommand(db, text, getParser(), { now: new Date(), timeZone: config.notifyTimezone }, deviceId)
      .then((result) => res.json(result))
      .catch(next);
  });

  /**
   * Undo a voice command: deletes exactly what it created. Only the device (or browser) that
   * said it, within VOICE_UNDO_WINDOW_MS. Undoing twice is a 204 again, so a queued tap that's
   * sent twice is harmless. This is the one delete a device token can make outside list items.
   */
  router.delete("/commands/:id", (req, res) => {
    const deviceId = (res.locals.device as DeviceTokenDTO | undefined)?.id ?? null;
    undoVoiceCommand(db, idParam(req, "id", "command id"), deviceId, new Date());
    res.status(204).send();
  });

  return router;
}
