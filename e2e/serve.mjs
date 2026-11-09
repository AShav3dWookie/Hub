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
 * Voice commands go to scripts/fakeVoiceModel.mjs on E2E_MODEL_PORT, never the real API —
 * whatever ANTHROPIC_API_KEY the shell has — so the suite is free and the same every run.
 *
 * Nothing here touches port 3000, test-env/, or data/.
 */
import { execFileSync, spawn } from "node:child_process";
import { rmSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFakeVoiceModel } from "../scripts/fakeVoiceModel.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.E2E_PORT ?? "3100";
const MODEL_PORT = process.env.E2E_MODEL_PORT ?? "3101";
// The published image always bakes a version in (Dockerfile APP_VERSION -> VITE_APP_VERSION for
// the bundle, APP_VERSION for /api/health). Match that here: the shell version check compares the
// two and deliberately does nothing on a "dev" build, so a rig without one cannot exercise it.
const APP_VERSION = process.env.E2E_APP_VERSION ?? "9.9.9";
const artifactsDir = path.join(root, "e2e", ".artifacts");
const dbPath = path.join(artifactsDir, "e2e.db");

// `shell: true` so Windows resolves `npm` via PATHEXT — execFileSync("npm.cmd") throws
// EINVAL on current Node without it.
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: true, ...opts });
const npm = "npm";

if (process.env.E2E_SKIP_BUILD !== "1") {
  console.log(`[e2e] building shared + server + client… (version ${APP_VERSION})`);
  sh(npm, ["run", "build"], { env: { ...process.env, VITE_APP_VERSION: APP_VERSION } });
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

console.log(`[e2e] starting the fake voice model on :${MODEL_PORT}`);
const fakeModel = createFakeVoiceModel().listen(Number(MODEL_PORT), "127.0.0.1");

console.log(`[e2e] starting server on :${PORT}`);
// cwd = server/ so the app finds its static bundle at ./public (see app.ts).
// Auth is off here. The login flow is covered by unit/integration tests and the
// docker-compose.auth.yml rig (see docs/wan-security.md); if an auth-on e2e pass
// is ever wanted, gate it behind an env flag and set AUTH_ENABLED / SESSION_SECRET
// / AUTH_PASSWORD_HASH below.
const server = spawn(process.execPath, [path.join("dist", "index.js")], {
  cwd: path.join(root, "server"),
  stdio: "inherit",
  env: {
    ...process.env,
    DB_PATH: dbPath,
    PORT,
    AUTH_ENABLED: "false",
    NODE_ENV: "production",
    APP_VERSION,
    ANTHROPIC_API_KEY: "e2e-fake-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`,
  },
});

const shutdown = () => {
  server.kill();
  fakeModel.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.on("exit", (code) => process.exit(code ?? 0));
