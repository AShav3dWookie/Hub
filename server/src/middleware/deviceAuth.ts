import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { DeviceTokenScope } from "@logger/shared";
import type { AppDb } from "../db/client.js";
import { authenticateDeviceToken } from "../services/deviceTokensService.js";
import { writeLogOnce } from "../services/serverLogService.js";
import { requireAuth } from "./auth.js";

/** A device retrying with a revoked token is logged once per this long, not on every retry. */
const REJECTED_TOKEN_LOG_MS = 10 * 60 * 1000;

/**
 * For routes a device (not a browser) calls: a valid `Authorization: Bearer <device token>` of
 * the route's `scope` passes, and with no token the request is treated like any other `/api`
 * call (`requireAuth`).
 *
 * A token that is *present but wrong* is a 401 even when auth is off. That is a device with a
 * revoked or mistyped token, and it should fail loudly rather than slip through on the LAN and
 * then mysteriously stop working the day the request comes over the WAN. A real token of the
 * other scope is a 403: the phone's token can't read the logs, and a logs token can't add to a
 * list.
 */
export function requireDeviceOrSession(db: AppDb, scope: DeviceTokenScope = "device"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    if (!header) {
      requireAuth(req, res, next);
      return;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const device = match ? authenticateDeviceToken(db, match[1]) : null;
    if (device && device.scope === scope) {
      // For routes that answer "which device is this?" — GET /api/voice/status.
      res.locals.device = device;
      next();
      return;
    }
    const path = req.originalUrl.split("?")[0];
    if (device) {
      writeLogOnce(
        db,
        { level: "warn", source: "http", message: `${device.name}'s ${device.scope} token was refused at ${path}` },
        REJECTED_TOKEN_LOG_MS,
      );
      res.status(403).json({ error: `This token is for ${device.scope === "logs" ? "reading logs" : "a device"} only` });
      return;
    }
    writeLogOnce(
      db,
      { level: "warn", source: "http", message: `An unknown or revoked device token was refused at ${path}` },
      REJECTED_TOKEN_LOG_MS,
    );
    res.status(401).json({ error: "Invalid device token" });
  };
}
