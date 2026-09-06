/**
 * Generate a bcrypt hash for the login password (the value of AUTH_PASSWORD_HASH).
 *
 * Usage (from repo root):
 *   npm run auth:hash -- 'your password'
 *   printf %s 'your password' | npm run auth:hash
 *
 * Paste the printed hash into your `.env` as AUTH_PASSWORD_HASH. In docker-compose
 * files, escape every `$` as `$$` so Compose does not treat it as interpolation.
 */
import bcrypt from "bcryptjs";

const COST = 12;
const MIN_LENGTH = 8;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

const password = process.argv[2] ?? (await readStdin());

if (!password || password.length < MIN_LENGTH) {
  // eslint-disable-next-line no-console
  console.error(
    `Password must be at least ${MIN_LENGTH} characters.\n` +
      "Usage: npm run auth:hash -- 'your password'   (or pipe it on stdin)",
  );
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(bcrypt.hashSync(password, COST));
