import { Router } from "express";
import { config } from "../config.js";

export const healthRouter = Router();

// Open (mounted ahead of requireAuth) so a proxy, the Docker HEALTHCHECK and a plain curl can all
// reach it. `version` is the released image tag, which makes this the quickest way to confirm what
// is actually running on the server after a deploy.
healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", version: config.appVersion });
});
