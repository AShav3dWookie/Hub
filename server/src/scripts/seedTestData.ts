/**
 * Seeds a fresh SQLite DB with a realistic set of test data for manual testing.
 *
 * Usage (from repo root):
 *   npm run seed:test-data --workspace server
 *
 * Writes to `test-env/logger.db` at the repo root by default (override with
 * DB_PATH). Deletes any existing DB file at that path first, so it's always a
 * clean slate. Reuses the real service layer (createLog / findOrCreateEntity)
 * so all the normal business rules (person dedup, normalized titles, etc.)
 * apply exactly as they would through the API.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../db/migrate.js";
import { createLog } from "../services/logService.js";
import { findOrCreateEntity } from "../services/entityService.js";
import type { AppDb } from "../db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const dbPath = process.env.DB_PATH ?? path.join(repoRoot, "test-env", "logger.db");

for (const suffix of ["", "-wal", "-shm"]) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.rmSync(p);
}

const db: AppDb = runMigrations(dbPath);

function log(
  category: "movie" | "tv" | "restaurant" | "book" | "game",
  title: string,
  date: string,
  rating: number | null,
  notes: string | null,
  people: string[] = [],
) {
  createLog(db, {
    category,
    title,
    date,
    rating,
    notes,
    people: people.map((name) => ({ name })),
  });
}

// --- Movies ---
log("movie", "Interstellar", "2026-05-02", 5, "Still holds up. Cried at the docking scene.", [
  "Alice",
  "Bob",
]);
log("movie", "Dune: Part Two", "2026-05-16", 5, "Better than the first one.", ["Alice"]);
log("movie", "The Grand Budapest Hotel", "2026-06-01", 4, null, ["Carol"]);
log("movie", "Everything Everywhere All At Once", "2026-06-20", 5, "Rewatch, still incredible.", [
  "Bob",
  "Carol",
]);

// --- TV (multiple logs per show, e.g. per-season rewatches) ---
log("tv", "The Bear", "2026-05-10", 4, "Season 1.", ["Alice"]);
log("tv", "The Bear", "2026-07-05", 5, "Season 2, even better.", ["Alice", "Dave"]);
log("tv", "Severance", "2026-06-12", 5, "Season 1 binge.", ["Dave"]);
log("tv", "Slow Horses", "2026-07-22", 4, null, []);

// --- Restaurants (repeat visits) ---
log("restaurant", "Chipotle", "2026-05-05", 3, "Quick lunch.", []);
log("restaurant", "Chipotle", "2026-07-18", 4, "Better than last time.", ["Bob"]);
log("restaurant", "Din Tai Fung", "2026-06-08", 5, "Xiao long bao were perfect.", [
  "Carol",
  "Dave",
]);
log("restaurant", "Joe's Pizza", "2026-08-01", 4, null, ["Alice"]);

// --- Books ---
log("book", "Dune", "2026-04-20", 5, "Reread before the movie.", []);
log("book", "Project Hail Mary", "2026-06-30", 5, "Couldn't put it down.", ["Bob"]);
log("book", "The Hobbit", "2026-07-15", 4, null, []);

// --- Games ---
log("game", "Hades", "2026-05-25", 5, "Finally beat it.", ["Dave"]);
log("game", "Baldur's Gate 3", "2026-07-01", 5, "Co-op with the usual crew.", [
  "Alice",
  "Bob",
  "Carol",
]);
log("game", "Stardew Valley", "2026-08-10", 3, null, []);

// A person with no logged appearances yet, to test the "no logs" empty state
// on a person's profile page.
findOrCreateEntity(db, "person", "Eve");

// eslint-disable-next-line no-console
console.log(`Seeded test data into ${dbPath}`);
