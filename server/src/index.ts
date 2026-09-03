import { assertSecureConfig, config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createApp } from "./app.js";
import { sweepExpiredAppointments } from "./services/upcomingEventsService.js";

// Fail before opening a port rather than serving a deployment that only looks protected.
assertSecureConfig();

const db = runMigrations(config.dbPath);
sweepExpiredAppointments(db);
const app = createApp(db);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Logger server listening on port ${config.port} (auth: ${config.authEnabled ? "enabled" : "disabled"})`);
});
