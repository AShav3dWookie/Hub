import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { getUpcomingImportantDates } from "../services/importantDatesService.js";

export function createImportantDatesRouter(db: AppDb): Router {
  const router = Router();

  router.get("/upcoming", (_req, res) => {
    res.json(getUpcomingImportantDates(db));
  });

  return router;
}
