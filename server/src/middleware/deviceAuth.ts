import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { AppDb } from "../db/client.js";
import { authenticateDeviceToken } from "../services/deviceTokensService.js";
import { requireAuth } from "./auth.js";

/**
 * For routes a device (not a browser) calls: a valid `Authorization: Bearer <device token>`
 * passes, and with no token the request is treated like any other `/api` call (`requireAuth`).
 *
 * A token that is *present but wrong* is a 401 even when auth is off. That is a device with a
 * revoked or mistyped token, and it should fail loudly rather than slip through on the LAN and
 * then mysteriously stop working the day the request comes over the WAN.
 */
export function requireDeviceOrSession(db: AppDb): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    if (!header) {
      requireAuth(req, res, next);
      return;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (match && authenticateDeviceToken(db, match[1])) {
      next();
      return;
    }
    res.status(401).json({ error: "Invalid device token" });
  };
}
