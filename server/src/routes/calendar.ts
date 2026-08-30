import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { getCalendarRange } from "../services/calendarService.js";
import { calendarRangeQuerySchema } from "../lib/validation.js";

export function createCalendarRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { from, to } = calendarRangeQuerySchema.parse(req.query);
    res.json(getCalendarRange(db, from, to));
  });

  return router;
}
