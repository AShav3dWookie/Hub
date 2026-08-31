import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { getChanges } from "../services/syncService.js";
import { syncChangesQuerySchema } from "../lib/validation.js";

export function createSyncRouter(db: AppDb): Router {
  const router = Router();

  // Delta-sync change-feed. `?since=<cursor>` (default 0 = full bootstrap), `?limit=` (default 500).
  router.get("/changes", (req, res) => {
    const { since, limit } = syncChangesQuerySchema.parse(req.query);
    res.json(getChanges(db, { since, limit }));
  });

  return router;
}
