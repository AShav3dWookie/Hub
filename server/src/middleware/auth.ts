import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

// Note: @types/cookie-session's `CookieSessionObject` already has a
// `[propertyName: string]: any` index signature, so custom session fields like
// `authenticated` are accessible without further module augmentation.

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.authEnabled) {
    next();
    return;
  }
  if (req.session?.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}
