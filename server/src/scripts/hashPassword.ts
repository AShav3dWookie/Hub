/**
 * Generate a bcrypt hash for the login password (the value of AUTH_PASSWORD_HASH).
 *
 * Usage (from repo root):
 *   npm run auth:hash -- 'your password'
 *   printf %s 'your password' | npm run auth:hash
 *
 * Paste the printed hash into your `.env` as AUTH_PASSWORD_HASH. In docker-compose
 * files, escape every `$` as `$$` so Compose does not treat it as interpolation.
 *
 * This only prints a hash — it does not touch the database. To change the password of a running
 * deployment (including recovering a forgotten one), use `auth:set-password` instead.
 */
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
      "Usage: npm run auth:hash -- 'your password'   (or pipe it on stdin)",
  );
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(await hashPassword(password));
