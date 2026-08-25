import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { search } from "../services/searchService.js";
import { searchQuerySchema } from "../lib/validation.js";

export function createSearchRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const query = searchQuerySchema.parse(req.query);
    const result = search(db, query);
    res.json(result);
  });

  return router;
}
