import { Router } from "express";
import { idParam } from "../lib/params.js";
import type { AppDb } from "../db/client.js";
import {
  createDeviceToken,
  listDeviceTokens,
  revokeDeviceToken,
} from "../services/deviceTokensService.js";
import { createDeviceTokenSchema } from "../lib/validation.js";

/**
 * Managing devices is a signed-in browser's job: app.ts mounts this behind `requireAuth`, not
 * `requireDeviceOrSession`, so a device token can never mint or revoke tokens.
 */
export function createDeviceTokensRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(listDeviceTokens(db));
  });

  router.post("/", (req, res) => {
    const { name } = createDeviceTokenSchema.parse(req.body);
    res.status(201).json(createDeviceToken(db, name));
  });

  router.delete("/:id", (req, res) => {
    revokeDeviceToken(db, idParam(req, "id", "device id"));
    res.status(204).send();
  });

  return router;
}
