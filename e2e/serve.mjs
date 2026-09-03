/**
 * Builds the whole app and serves the production bundle for the e2e / PWA test suite.
 *
 * Runs as Playwright's `webServer` (see playwright.config.ts) and is also runnable
 * standalone for hands-on poking:  `node e2e/serve.mjs`  →  http://localhost:3100
 *
 * Steps: build (shared → server → client) → copy client/dist into server/public →
 * wipe + re-seed a scratch SQLite DB under e2e/.artifacts → start server/dist/index.js
 * with AUTH disabled on E2E_PORT. Set E2E_SKIP_BUILD=1 to reuse the previous build.
 *
 * Nothing here touches port 3000, test-env/, or data/.
 */
import { execFileSync, spawn } from "node:child_process";
import { rmSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.E2E_PORT ?? "3100";
const artifactsDir = path.join(root, "e2e", ".artifacts");
const dbPath = path.join(artifactsDir, "e2e.db");

// `shell: true` so Windows resolves `npm` via PATHEXT — execFileSync("npm.cmd") throws
// EINVAL on current Node without it.
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: true, ...opts });
const npm = "npm";

if (process.env.E2E_SKIP_BUILD !== "1") {
  console.log("[e2e] building shared + server + client…");
  sh(npm, ["run", "build"]);
}

console.log("[e2e] copying client/dist → server/public");
const serverPublic = path.join(root, "server", "public");
rmSync(serverPublic, { recursive: true, force: true });
mkdirSync(serverPublic, { recursive: true });
cpSync(path.join(root, "client", "dist"), serverPublic, { recursive: true });

console.log("[e2e] seeding a fresh scratch DB at", dbPath);
mkdirSync(artifactsDir, { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
sh(npm, ["run", "seed:test-data", "--workspace", "server"], {
  env: { ...process.env, DB_PATH: dbPath },
});

console.log(`[e2e] starting server on :${PORT}`);
// cwd = server/ so the app finds its static bundle at ./public (see app.ts).
const server = spawn(process.execPath, [path.join("dist", "index.js")], {
  cwd: path.join(root, "server"),
  stdio: "inherit",
  env: { ...process.env, DB_PATH: dbPath, PORT, AUTH_ENABLED: "false", NODE_ENV: "production" },
});

const shutdown = () => {
  server.kill();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.on("exit", (code) => process.exit(code ?? 0));
