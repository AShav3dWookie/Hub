/**
 * Set the login password directly in the database — the way back in after a forgotten one.
 *
 * In a running container:
 *   docker compose exec app node dist/scripts/setPassword.js 'new password'
 *
 * Locally (from repo root):
 *   npm run auth:set-password -- 'new password'
 *   printf %s 'new password' | npm run auth:set-password
 *
 * The new hash takes effect on the next login — no restart. It overrides AUTH_PASSWORD_HASH from
 * the environment, which is only consulted while no password has ever been set here.
 */
import { config } from "../config.js";
import { runMigrations } from "../db/migrate.js";
import { setStoredPasswordHash } from "../services/authCredentialsService.js";
import {
  hashPassword,
  readStdin,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from "../lib/passwordHash.js";

const password = process.argv[2] ?? (await readStdin());

if (
  !password ||
  password.length < MIN_PASSWORD_LENGTH ||
  password.length > MAX_PASSWORD_LENGTH
) {
  // eslint-disable-next-line no-console
  console.error(
    `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.\n` +
      "Usage: npm run auth:set-password -- 'new password'   (or pipe it on stdin)",
  );
  process.exit(1);
}

const db = runMigrations(config.dbPath);
setStoredPasswordHash(db, await hashPassword(password));
db.$client.close();

// eslint-disable-next-line no-console
console.log(`Login password updated in ${config.dbPath}. It takes effect on the next login.`);
