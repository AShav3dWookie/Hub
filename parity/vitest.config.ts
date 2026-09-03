import { defineConfig } from "vitest/config";

/**
 * The parity suite spans both workspaces at once: it drives the real server services against a
 * real SQLite file, and the client's offline query layer against a snapshot built from that same
 * database. It therefore lives outside either workspace, next to `e2e/`, with its own config.
 *
 * The environment is `node` — the client modules under test are pure functions over a plain
 * object and never touch the DOM or IndexedDB.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Each case opens its own SQLite file; running files in one process keeps handle
    // cleanup predictable on Windows.
    pool: "threads",
  },
});
