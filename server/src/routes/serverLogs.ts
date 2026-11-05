import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { serverLogsQuerySchema } from "../lib/validation.js";
import { formatLogs, listLogs, parseSince } from "../services/serverLogService.js";

/**
 * `GET /api/device/logs` — the hub's own log (docs/logs.md). app.ts mounts this behind
 * `requireDeviceOrSession(db, "logs")`: a logs token or a signed-in browser reads it; the
 * phone's token can't. It sits under `/api/device` so it reaches the WAN through the same
 * Authelia bypass as the companion app, with no proxy change. Read-only by design.
 *
 * `?since=2h|30m|3d|<ISO>&level=info|warn|error&source=voice&limit=200&format=json|text`
 */
export function createServerLogsRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { since, level, source, limit, format } = serverLogsQuerySchema.parse(req.query);
    const entries = listLogs(db, { since: since ? parseSince(since) : undefined, level, source, limit });
    if (format === "text") {
      res.type("text/plain").send(entries.length > 0 ? `${formatLogs(entries)}\n` : "");
      return;
    }
    res.json(entries);
  });

  return router;
}
