// Gives jsdom a working IndexedDB and clears it between tests. Loaded as a second vitest
// setupFile alongside setup.ts.
import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { deleteDB } from "idb";
import { DB_NAME, closeDB } from "../local/db.js";

afterEach(async () => {
  await closeDB();
  try {
    await deleteDB(DB_NAME);
  } catch {
    // best-effort — a test that never opened the DB has nothing to delete
  }
});
