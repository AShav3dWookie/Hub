import { Router } from "express";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { loginSchema } from "../lib/validation.js";
import { AppError } from "../lib/errors.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  if (!config.authEnabled) {
    res.json({ authenticated: true, authRequired: false });
    return;
  }
  const { password } = loginSchema.parse(req.body);
  if (!config.authPasswordHash) {
    throw new AppError(500, "AUTH_PASSWORD_HASH is not configured");
  }
  const valid = await bcrypt.compare(password, config.authPasswordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  req.session!.authenticated = true;
  res.json({ authenticated: true, authRequired: true });
});

authRouter.post("/logout", (req, res) => {
  req.session = null;
  res.status(204).send();
});

authRouter.get("/status", (req, res) => {
  res.json({
    authRequired: config.authEnabled,
    authenticated: config.authEnabled ? Boolean(req.session?.authenticated) : true,
  });
});
