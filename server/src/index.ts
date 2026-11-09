import { assertNotificationConfig, assertSecureConfig, warnInsecureConfig, config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createApp } from "./app.js";
import { sweepExpiredAppointments } from "./services/upcomingEventsService.js";
import { getOrCreateVapidKeys } from "./services/pushKeysService.js";
import { startNotificationScheduler } from "./services/notificationScheduler.js";
import { createWebPushSender, generateVapidKeys } from "./lib/webPush.js";
import { writeLog } from "./services/serverLogService.js";

// Fail before opening a port rather than serving a deployment that only looks protected.
assertSecureConfig();
assertNotificationConfig();
warnInsecureConfig();

const db = runMigrations(config.dbPath);
// The first thing to check when something behaves oddly: which build, and is the model on?
writeLog(db, {
  level: "info",
  source: "server",
  message: `Started ${config.appVersion} (voice: ${config.anthropicApiKey ? `model ${config.voiceModel}` : "off, no ANTHROPIC_API_KEY"})`,
  data: {
    version: config.appVersion,
    auth: config.authEnabled,
    voiceParser: config.anthropicApiKey ? "model" : "none",
    voiceModel: config.voiceModel,
    timeZone: config.notifyTimezone,
  },
});
sweepExpiredAppointments(db);

const vapidKeys = getOrCreateVapidKeys(db, generateVapidKeys);
const sendPush = createWebPushSender(vapidKeys, config.vapidSubject);

const app = createApp(db, config.photosDir, { vapidPublicKey: vapidKeys.publicKey, sendPush });
startNotificationScheduler(db, { timeZone: config.notifyTimezone, send: sendPush });

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Logger server listening on port ${config.port} (auth: ${config.authEnabled ? "enabled" : "disabled"})`);
});
