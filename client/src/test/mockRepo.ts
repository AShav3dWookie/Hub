import { vi } from "vitest";
import type { Repo } from "../local/repo.js";

/**
 * Tests that fire a mutation should stub out the post-mutation sync pull so they need no
 * `/api/sync/changes` handler. `vi.mock` hoists above imports so it can't reference a helper —
 * inline this factory:
 *
 *   vi.mock("../api/afterMutation.js", () => ({
 *     refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
 *       void qc.invalidateQueries();
 *       return Promise.resolve();
 *     },
 *   }));
 */

/**
 * Helpers for component/route tests that mock the local read layer instead of seeding
 * IndexedDB. Use when the test is about a component's rendering or its query-building, not
 * about the port logic (which `src/local/*.test.ts` covers directly).
 *
 *   vi.mock("../local/repo.js");
 *   import { repo } from "../local/repo.js";
 *   beforeEach(() => primeRepo(repo));
 *   vi.mocked(repo.search).mockResolvedValue({ groupBy: "entity", entities: [...] });
 */
export function primeRepo(repo: Repo): void {
  vi.mocked(repo.searchEntitiesByTitle).mockResolvedValue([]);
  vi.mocked(repo.search).mockResolvedValue({ groupBy: "entity", entities: [] });
  vi.mocked(repo.getGallery).mockResolvedValue({ photos: [], nextCursor: null });
  vi.mocked(repo.listAlbums).mockResolvedValue([]);
  vi.mocked(repo.listEntityNotes).mockResolvedValue([]);
  vi.mocked(repo.getCalendarRange).mockResolvedValue({ from: "", to: "", items: [] });
  vi.mocked(repo.getUpcomingImportantDates).mockResolvedValue({ today: [], next7Days: [] });
  vi.mocked(repo.getUpcomingEvents).mockResolvedValue({ today: [], next7Days: [] });
  // getEntityDetail / getAlbum have no safe default — set them per test.
}
