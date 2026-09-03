import path from "node:path";

const dbPath = process.env.DB_PATH ?? "./data/logger.db";

/**
 * The fallback used when SESSION_SECRET is unset. It is fine for LAN development with auth off,
 * but it is committed to the repo, so signing real sessions with it would let anyone forge an
 * authenticated cookie. `assertSecureConfig` refuses to start in that combination.
 */
export const DEV_SESSION_SECRET = "dev-insecure-secret-change-me";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath,
  // Uploaded log photos live alongside the SQLite file so they share the same
  // persistent Docker volume (logger-data mounted at /app/data) with no extra
  // mount. Overridable for tests / non-standard layouts.
  photosDir: process.env.PHOTOS_DIR ?? path.join(path.dirname(dbPath), "photos"),
  // ffmpeg is used only to decode a single poster frame from uploaded videos. The Docker
  // image installs it (apk add ffmpeg); local dev without it falls back to a generated
  // placeholder poster. Override the resolved binary with FFMPEG_PATH.
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  authEnabled: process.env.AUTH_ENABLED === "true",
  authPasswordHash: process.env.AUTH_PASSWORD_HASH ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? DEV_SESSION_SECRET,
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Whether to mark the auth session cookie as `Secure`. Defaults to false because
  // this app is typically deployed behind a reverse proxy (nginx/Cloudflare) that
  // terminates TLS, meaning the app itself receives plain HTTP — setting `secure`
  // based on NODE_ENV alone would silently break the session cookie in that (very
  // common) setup, since browsers/clients won't send/accept Secure cookies over
  // HTTP. Only set COOKIE_SECURE=true if this process itself terminates HTTPS.
  cookieSecure: process.env.COOKIE_SECURE === "true",
};

/**
 * Refuse to start in a configuration that only looks secure.
 *
 * Auth is off by default for LAN use, and with it off the session secret never protects
 * anything. But once auth is turned on, a deploy that forgot SESSION_SECRET would sign session
 * cookies with the constant above, which is in the repository — so anyone could mint a cookie
 * that says `authenticated` and walk straight past `requireAuth`. Failing loudly at startup is
 * far better than appearing to work.
 *
 * Called from the entrypoint, not at module load, so tests can construct the app freely.
 */
export function assertSecureConfig(cfg: typeof config = config): void {
  if (cfg.authEnabled && cfg.sessionSecret === DEV_SESSION_SECRET) {
    throw new Error(
      "AUTH_ENABLED is true but SESSION_SECRET is still the built-in development value. " +
        "Session cookies would be signed with a secret that is public in the repository, so " +
        "anyone could forge a logged-in session. Set SESSION_SECRET to a long random string.",
    );
  }
  if (cfg.authEnabled && !cfg.authPasswordHash) {
    throw new Error(
      "AUTH_ENABLED is true but AUTH_PASSWORD_HASH is empty, so no password could ever be " +
        "accepted and every login would fail with a 500. Set AUTH_PASSWORD_HASH to a bcrypt hash.",
    );
  }
}
