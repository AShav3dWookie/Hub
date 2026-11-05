import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppDb } from "../db/client.js";
import { AppError } from "../lib/errors.js";
import { writeLog } from "../services/serverLogService.js";

/**
 * Maps errors to responses. Given the db, a 500 also goes into the hub's log with its stack
 * (docs/logs.md); 4xx are the caller's mistake and are left out.
 */
export function createErrorHandler(db?: AppDb): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.flatten() });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    const path = req.originalUrl?.split("?")[0];
    if (db) {
      writeLog(db, {
        level: "error",
        source: "http",
        message: `500 on ${req.method} ${path}: ${(err as Error)?.message ?? String(err)}`,
        data: { stack: (err as Error)?.stack ?? null },
      });
    } else {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(500).json({ error: "Internal server error" });
  };
}

export const errorHandler = createErrorHandler();
