import path from "node:path";

const dbPath = process.env.DB_PATH ?? "./data/logger.db";

/**
 * The fallback used when SESSION_SECRET is unset. It is fine for LAN development with auth off,
 * but it is committed to the repo, so signing real sessions with it would let anyone forge an
 * authenticated cookie. `assertSecureConfig` refuses to start in that combination.
 */
export const DEV_SESSION_SECRET = "dev-insecure-secret-change-me";

/**
 * Placeholder session secrets that must never sign a real session. `DEV_SESSION_SECRET` and the
 * `docker-compose.yml` / `.env.example` default both live in this repository, so a deploy that
 * forgot to set `SESSION_SECRET` would sign `authenticated` cookies with a value anyone can read.
 */
const PLACEHOLDER_SESSION_SECRETS = new Set([
  DEV_SESSION_SECRET,
  "change-me-in-production",
  "change-me",
  "changeme",
  "secret",
  "password",
]);

const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * Parse `TRUST_PROXY`. Behind nginx/Cloudflare the app receives plain HTTP and must trust the
 * proxy's `X-Forwarded-Proto` for `req.secure` / the cookie `Secure` flag to be correct. There is
 * exactly one hop (only nginx can reach the container port), so the default when auth is on is `1`.
 * On the trusted LAN with auth off we trust nothing, so no `X-Forwarded-*` spoofing surface is added.
 */
function parseTrustProxy(raw: string | undefined, authEnabled: boolean): number | boolean | string {
  if (raw === undefined || raw === "") return authEnabled ? 1 : false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (Number.isInteger(n)) return n;
  return raw; // "loopback" | "uniquelocal" | a CSV of IPs/CIDRs — Express parses these itself
}

/**
 * Parse `COOKIE_SECURE`. Unset means "auto-derive per request from `req.protocol`", which is the
 * right behaviour everywhere: plain HTTP on the LAN (not Secure), and HTTPS via the proxy (Secure,
 * once `trust proxy` + `X-Forwarded-Proto: https` are in place). `true`/`false` force it — but
 * forcing `true` on a request cookie-session considers unencrypted makes it silently drop the
 * cookie, so the override exists mainly for a process that terminates its own TLS.
 */
function parseCookieSecure(raw: string | undefined): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

const authEnabled = process.env.AUTH_ENABLED === "true";

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
  authEnabled,
  authPasswordHash: process.env.AUTH_PASSWORD_HASH ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? DEV_SESSION_SECRET,
  nodeEnv: process.env.NODE_ENV ?? "development",
  // How Express treats X-Forwarded-* headers. See parseTrustProxy above.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, authEnabled),
  // Whether to mark the auth session cookie as `Secure`. `undefined` (the default) auto-derives
  // it per request from req.protocol, which is what a proxy deployment wants. See parseCookieSecure.
  cookieSecure: parseCookieSecure(process.env.COOKIE_SECURE) as boolean | undefined,
  // Lifetime of the auth session cookie. The cookie is persistent (survives a browser restart)
  // and its expiry slides forward on activity (see app.ts), so a regular user re-logs in only
  // after being away this long. `|| 90` also catches an empty-string env var (compose passes
  // `SESSION_MAX_AGE_DAYS=` when the host has not set it).
  sessionMaxAgeDays: Number(process.env.SESSION_MAX_AGE_DAYS || 90) || 90,
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
  if (!cfg.authEnabled) return;

  if (PLACEHOLDER_SESSION_SECRETS.has(cfg.sessionSecret)) {
    throw new Error(
      "AUTH_ENABLED is true but SESSION_SECRET is still a known placeholder value. " +
        "Session cookies would be signed with a secret that is public in the repository, so " +
        "anyone could forge a logged-in session. Generate one with `openssl rand -base64 48`.",
    );
  }
  if (cfg.sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `AUTH_ENABLED is true but SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} ` +
        "characters, so a forged session cookie would be feasible to brute-force. Generate one " +
        "with `openssl rand -base64 48`.",
    );
  }
  if (!cfg.authPasswordHash) {
    throw new Error(
      "AUTH_ENABLED is true but AUTH_PASSWORD_HASH is empty, so no password could ever be " +
        "accepted and every login would fail with a 500. Set AUTH_PASSWORD_HASH to a bcrypt " +
        "hash (`npm run auth:hash -- 'your-password'`).",
    );
  }
}

/**
 * Non-fatal warnings for a configuration that works but is weaker than a WAN deployment wants.
 * Called from the entrypoint only, so tests can build the app in any configuration without noise.
 */
export function warnInsecureConfig(cfg: typeof config = config): void {
  if (!cfg.authEnabled) return;
  if (cfg.trustProxy === false) {
    // eslint-disable-next-line no-console
    console.warn(
      "[config] AUTH_ENABLED is on but TRUST_PROXY is off. Behind nginx/Cloudflare the session " +
        "cookie will not be marked Secure and client IPs will all read as the proxy. Set TRUST_PROXY=1.",
    );
  }
  if (cfg.cookieSecure === false) {
    // eslint-disable-next-line no-console
    console.warn(
      "[config] AUTH_ENABLED is on but COOKIE_SECURE=false — the session cookie may be sent over " +
        "plain HTTP. Leave COOKIE_SECURE unset to auto-derive it from X-Forwarded-Proto.",
    );
  }
}
