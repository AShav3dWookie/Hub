import { Router } from "express";
import type { AppDb } from "../db/client.js";
import { config } from "../config.js";
import { loginSchema, changePasswordSchema } from "../lib/validation.js";
import { AppError, BadRequestError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { hashPassword, verifyPassword } from "../lib/passwordHash.js";
import {
  getStoredPasswordHash,
  setStoredPasswordHash,
} from "../services/authCredentialsService.js";

export function createAuthRouter(db: AppDb): Router {
  const router = Router();

  /**
   * The password in the database wins; `AUTH_PASSWORD_HASH` is only a fallback for a deployment
   * that has never changed it. Read per request rather than cached, so `auth:set-password` takes
   * effect on the next login with no restart.
   */
  const resolvePasswordHash = (): string => getStoredPasswordHash(db) ?? config.authPasswordHash;

  // These two handlers await bcrypt, and Express 4 does not forward a rejected promise to the
  // error middleware — an uncaught throw here would hang the request instead of returning 400/500.
  // Hence the explicit `next(err)`; the synchronous routes below don't need it.
  router.post("/login", async (req, res, next) => {
    try {
      if (!config.authEnabled) {
        res.json({ authenticated: true, authRequired: false });
        return;
      }
      const { password } = loginSchema.parse(req.body);
      const hash = resolvePasswordHash();
      if (!hash) {
        throw new AppError(500, "AUTH_PASSWORD_HASH is not configured");
      }
      if (!(await verifyPassword(password, hash))) {
        res.status(401).json({ error: "Invalid password" });
        return;
      }
      req.session!.authenticated = true;
      res.json({ authenticated: true, authRequired: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", (req, res) => {
    req.session = null;
    res.status(204).send();
  });

  router.get("/status", (req, res) => {
    res.json({
      authRequired: config.authEnabled,
      authenticated: config.authEnabled ? Boolean(req.session?.authenticated) : true,
    });
  });

  // This router is mounted ahead of the global `requireAuth` so that login stays reachable, so the
  // one route that changes state guards itself. `requireAuth` is a pass-through when auth is off,
  // which is why the disabled case is rejected in the handler rather than left open.
  router.post("/password", requireAuth, async (req, res, next) => {
    try {
      if (!config.authEnabled) {
        throw new BadRequestError("Password login is disabled");
      }
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const hash = resolvePasswordHash();
      if (!hash || !(await verifyPassword(currentPassword, hash))) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
      setStoredPasswordHash(db, await hashPassword(newPassword));
      // The session is left alone: the person who just proved they know the password should not be
      // logged out. Other devices keep their cookies until those expire (cookie-session is
      // stateless, so there is no session store to clear).
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
