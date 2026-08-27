import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { getUpcomingEvents, sweepExpiredAppointments } from "../services/upcomingEventsService.js";

export function createEventsRouter(db: AppDb): Router {
  const router = Router();

  router.get("/upcoming", (_req, res) => {
    // An always-on server rarely restarts, so sweep expired auto-delete appointments here too.
    sweepExpiredAppointments(db);
    res.json(getUpcomingEvents(db));
  });

  return router;
}
