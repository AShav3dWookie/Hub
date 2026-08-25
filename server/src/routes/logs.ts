import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { createLog, updateLog, deleteLog, getLogById } from "../services/logService.js";
import { createLogSchema, updateLogSchema } from "../lib/validation.js";
import { BadRequestError } from "../lib/errors.js";

export function createLogsRouter(db: AppDb): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const input = createLogSchema.parse(req.body);
    const log = createLog(db, input);
    res.status(201).json(log);
  });

  router.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestError("Invalid log id");
    }
    res.json(getLogById(db, id));
  });

  router.put("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestError("Invalid log id");
    }
    const input = updateLogSchema.parse(req.body);
    const log = updateLog(db, id, input);
    res.json(log);
  });

  router.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestError("Invalid log id");
    }
    deleteLog(db, id);
    res.status(204).send();
  });

  return router;
}
