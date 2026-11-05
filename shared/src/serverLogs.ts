/**
 * The hub's own log: what it did and why, kept on the server so it survives a container being
 * recreated and can be read from the PC (`npm run hub:logs`). Server-only — never synced.
 */

export const SERVER_LOG_LEVELS = ["info", "warn", "error"] as const;
export type ServerLogLevel = (typeof SERVER_LOG_LEVELS)[number];

/** Where an entry came from. `server` is startup; `http` is the request pipeline. */
export const SERVER_LOG_SOURCES = ["server", "http", "voice", "notifications"] as const;
export type ServerLogSource = (typeof SERVER_LOG_SOURCES)[number];

export interface ServerLogDTO {
  id: number;
  /** ISO timestamp, UTC. */
  at: string;
  level: ServerLogLevel;
  source: ServerLogSource;
  message: string;
  /** Structured detail — the model's answer, a stack, timings. */
  data: Record<string, unknown> | null;
}
