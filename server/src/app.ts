import express, { type Express } from "express";
import cors from "cors";
import cookieSession from "cookie-session";
import path from "node:path";
import fs from "node:fs";
import type { AppDb } from "./db/client.js";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { createEntitiesRouter } from "./routes/entities.js";
import { createLogsRouter } from "./routes/logs.js";
import { createSearchRouter } from "./routes/search.js";
import { createImportantDatesRouter } from "./routes/importantDates.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp(db: AppDb): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(
    cookieSession({
      name: "logger.sid",
      secret: config.sessionSecret,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
    }),
  );

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/entities", requireAuth, createEntitiesRouter(db));
  app.use("/api/logs", requireAuth, createLogsRouter(db));
  app.use("/api/search", requireAuth, createSearchRouter(db));
  app.use("/api/important-dates", requireAuth, createImportantDatesRouter(db));

  const clientDist = path.resolve(process.cwd(), "public");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
