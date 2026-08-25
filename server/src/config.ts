export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./data/logger.db",
  authEnabled: process.env.AUTH_ENABLED === "true",
  authPasswordHash: process.env.AUTH_PASSWORD_HASH ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Whether to mark the auth session cookie as `Secure`. Defaults to false because
  // this app is typically deployed behind a reverse proxy (nginx/Cloudflare) that
  // terminates TLS, meaning the app itself receives plain HTTP — setting `secure`
  // based on NODE_ENV alone would silently break the session cookie in that (very
  // common) setup, since browsers/clients won't send/accept Secure cookies over
  // HTTP. Only set COOKIE_SECURE=true if this process itself terminates HTTPS.
  cookieSecure: process.env.COOKIE_SECURE === "true",
};
