/**
 * The one place the app hashes and verifies the login password.
 *
 * The cost factor and the length bounds live here rather than in each caller so the change-password
 * route, the `auth:hash` script and the `auth:set-password` recovery script cannot drift apart.
 *
 * Everything is async on purpose: `bcrypt.hashSync` at cost 12 blocks the event loop for roughly a
 * quarter of a second, which is fine in a CLI script but not in a request handler.
 */
import bcrypt from "bcryptjs";

/** bcrypt work factor. */
export const BCRYPT_COST = 12;

export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt only consumes the first 72 bytes, so anything longer is silently truncated. */
export const MAX_PASSWORD_LENGTH = 72;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Read a password piped on stdin, for the CLI scripts. Empty when stdin is a terminal. */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}
