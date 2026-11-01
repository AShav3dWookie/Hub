import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { idParam } from "../lib/params.js";
import { deviceListLocationSchema } from "../lib/validation.js";
import { getList, listLists, setListLocation } from "../services/listService.js";

/**
 * What the companion app reaches with its device token, beyond /api/voice — app.ts mounts this
 * behind `requireDeviceOrSession`. Deliberately narrow: the app keeps a copy of the shopping
 * lists (so a shop's "Are you there?" works with no signal) and tags where a shop is. It can't
 * rename, delete or make anything main; that stays with a signed-in browser.
 */
export function createDeviceRouter(db: AppDb): Router {
  const router = Router();

  /** Every shopping list with its location and items: the app's whole cache in one request. */
  router.get("/lists", (_req, res) => {
    res.json(listLists(db, "shopping").map((summary) => getList(db, summary.id)));
  });

  /** Tag (or clear, with `{ "location": null }`) where a shop is. */
  router.put("/lists/:id/location", (req, res) => {
    const { location } = deviceListLocationSchema.parse(req.body);
    res.json(setListLocation(db, idParam(req, "id", "list id"), location));
  });

  return router;
}
