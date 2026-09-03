import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import { getChanges } from "../services/syncService.js";
import { applyMutations } from "../services/syncMutationsService.js";
import { syncChangesQuerySchema } from "../lib/validation.js";
import { syncMutationsRequestSchema } from "../lib/syncValidation.js";

export function createSyncRouter(db: AppDb, photosDir: string = config.photosDir): Router {
  const router = Router();

  // The change-feed and the mutation replay must never be served from an HTTP cache (Express
  // adds an ETag by default, which some clients will revalidate into a stale 304).
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // Delta-sync change-feed. `?since=<cursor>` (default 0 = full bootstrap), `?limit=` (default 500).
  router.get("/changes", (req, res) => {
    const { since, limit } = syncChangesQuerySchema.parse(req.query);
    res.json(getChanges(db, { since, limit }));
  });

  // Replay a batch of queued offline writes (the writes tier). Idempotent per `mutationId`.
  router.post("/mutations", (req, res) => {
    const { mutations } = syncMutationsRequestSchema.parse(req.body);
    res.json({ results: applyMutations(db, photosDir, mutations) });
  });

  return router;
}
