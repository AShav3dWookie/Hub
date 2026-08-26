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
import { createEntityNote } from "../services/entityNotesService.js";
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
  category: "movie" | "tv" | "eating_out" | "book" | "game",
  title: string,
  date: string,
  rating: number | null,
  notes: string | null,
  people: string[] = [],
  fields: { releaseYear?: number; author?: string } = {},
) {
  createLog(db, {
    category,
    title,
    date,
    rating,
    notes,
    people: people.map((name) => ({ name })),
    releaseYear: fields.releaseYear ?? null,
    author: fields.author ?? null,
  });
}

// --- Movies (day-precision "Date Watched", entity-level Release Year) ---
log(
  "movie",
  "Interstellar",
  "2026-05-02",
  5,
  "Still holds up. Cried at the docking scene.",
  ["Alice", "Bob"],
  { releaseYear: 2014 },
);
log("movie", "Dune: Part Two", "2026-05-16", 5, "Better than the first one.", ["Alice"], {
  releaseYear: 2024,
});
log("movie", "The Grand Budapest Hotel", "2026-06-01", 4, null, ["Carol"], { releaseYear: 2014 });
log(
  "movie",
  "Everything Everywhere All At Once",
  "2026-06-20",
  5,
  "Rewatch, still incredible.",
  ["Bob", "Carol"],
  { releaseYear: 2022 },
);

// --- TV (year-precision "Year Watched", no People, multiple logs per show) ---
log("tv", "The Bear", "2026-01-01", 4, "Season 1.");
log("tv", "The Bear", "2026-01-01", 5, "Season 2, even better.");
log("tv", "Severance", "2026-01-01", 5, "Season 1 binge.");
log("tv", "Slow Horses", "2026-01-01", 4, null);

// --- Eating Out (day-precision "Date Went") ---
log("eating_out", "Chipotle", "2026-05-05", 3, "Quick lunch.", []);
log("eating_out", "Chipotle", "2026-07-18", 4, "Better than last time.", ["Bob"]);
log("eating_out", "Din Tai Fung", "2026-06-08", 5, "Xiao long bao were perfect.", [
  "Carol",
  "Dave",
]);
log("eating_out", "Joe's Pizza", "2026-08-01", 4, null, ["Alice"]);

// --- Books (year-precision "Year Read", entity-level Author, no People) ---
log("book", "Dune", "2026-01-01", 5, "Reread before the movie.", [], { author: "Frank Herbert" });
log("book", "Project Hail Mary", "2026-01-01", 5, "Couldn't put it down.", [], {
  author: "Andy Weir",
});
log("book", "The Hobbit", "2026-01-01", 4, null, [], { author: "J.R.R. Tolkien" });

// --- Games (year-precision "Year Played", entity-level Release Year, no People) ---
log("game", "Hades", "2026-01-01", 5, "Finally beat it.", [], { releaseYear: 2020 });
log("game", "Baldur's Gate 3", "2026-01-01", 5, "Co-op with the usual crew.", [], {
  releaseYear: 2023,
});
log("game", "Stardew Valley", "2026-01-01", 3, null, [], { releaseYear: 2016 });

// A person with no logged appearances yet, to test the "no logs" empty state
// on a person's profile page.
findOrCreateEntity(db, "person", "Eve");

// --- Important dates (annual recurrence by month/day, tagged on person entities) ---
const alice = findOrCreateEntity(db, "person", "Alice");
createEntityNote(db, alice.id, {
  category: "important_date",
  body: "Don't forget the card!",
  tag: "Birthday",
  eventDate: "1990-05-12",
});
const bob = findOrCreateEntity(db, "person", "Bob");
createEntityNote(db, bob.id, {
  category: "important_date",
  body: "",
  tag: "Birthday",
  eventDate: "1988-09-30",
});
const carol = findOrCreateEntity(db, "person", "Carol");
createEntityNote(db, carol.id, {
  category: "important_date",
  body: "5th anniversary this year.",
  tag: "Anniversary",
  eventDate: "2019-11-03",
});

// eslint-disable-next-line no-console
console.log(`Seeded test data into ${dbPath}`);

