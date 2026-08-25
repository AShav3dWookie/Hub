import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createApp } from "./app.js";

const db = runMigrations(config.dbPath);
const app = createApp(db);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Logger server listening on port ${config.port} (auth: ${config.authEnabled ? "enabled" : "disabled"})`);
});
