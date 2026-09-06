import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SearchQuery } from "@logger/shared";
import { createParityFixture, TODAY, type ParityFixture } from "./helpers/fixture.js";

// Server read services.
import { search as serverSearch } from "../server/src/services/searchService.js";
import { listGalleryPhotos } from "../server/src/services/galleryService.js";
import { getCalendarRange as serverCalendar } from "../server/src/services/calendarService.js";
import { getUpcomingImportantDates as serverImportantDates } from "../server/src/services/importantDatesService.js";
import { getUpcomingEvents as serverUpcomingEvents } from "../server/src/services/upcomingEventsService.js";
import { listAlbums as serverListAlbums, getAlbumById } from "../server/src/services/albumService.js";
import { listEntityNotes as serverListNotes } from "../server/src/services/entityNotesService.js";
import {
  getEntityWithLogs,
  getPersonProfile,
} from "../server/src/services/entityDetailService.js";
import { searchEntitiesByTitle as serverAutocomplete } from "../server/src/services/entityService.js";

// The offline client's counterparts.
import * as local from "../client/src/local/queries.js";

/**
 * The two implementations of every read path must agree.
 *
 * The server answers from SQLite; the offline client answers from an in-memory snapshot of the
 * replica. Both now delegate their filtering, ordering and paging to the same rules in
 * `@logger/shared`, but they still fetch rows completely differently, so only an end-to-end
 * comparison proves they produce the same answer.
 *
 * The snapshot is built from the server's own change-feed, so the inputs are provably the same
 * data. Any divergence here is a real bug that offline users would see and online users would
 * not, which is the failure mode this suite exists to catch.
 */
describe("server and offline client read parity", () => {
  let fx: ParityFixture;

  beforeAll(() => {
    fx = createParityFixture();
  });

  afterAll(() => {
    fx.cleanup();
  });

  describe("search", () => {
    const cases: [name: string, query: SearchQuery][] = [
      ["no filters at all", {}],
      ["grouped by log", { groupBy: "log" }],
      ["a keyword over titles", { q: "dune" }],
      ["a keyword matching notes", { q: "cinematography" }],
      ["a keyword matching a tagged person", { q: "ada" }],
      ["a multi-word keyword in all mode", { q: "blade runner", qMode: "all" }],
      ["a multi-word keyword in any mode", { q: "blade dune", qMode: "any" }],
      ["a keyword that matches nothing", { q: "zzzzz" }],
      ["the movie category", { category: "movie" }],
      ["the book category", { category: "book" }],
      ["the person tab", { category: "person" }],
      ["the album tab", { category: "album" }],
      ["an author substring", { authorContains: "le guin" }],
      ["an accented author substring", { authorContains: "émile" }],
      ["an author substring in the wrong case", { authorContains: "LE GUIN" }],
      ["a release-year floor", { releaseYearMin: 2018 }],
      ["a release-year ceiling", { releaseYearMax: 2017 }],
      ["a release-year band", { releaseYearMin: 2016, releaseYearMax: 2019 }],
      ["a date floor", { dateFrom: "2026-01-01" }],
      ["a date ceiling", { dateTo: "2025-12-31" }],
      ["a rating floor", { ratingMin: 4 }],
      ["a rating ceiling", { ratingMax: 3 }],
      ["sorted by title ascending", { sortBy: "title", sortOrder: "asc" }],
      ["sorted by title descending", { sortBy: "title", sortOrder: "desc" }],
      ["sorted by rating ascending", { sortBy: "rating", sortOrder: "asc" }],
      ["sorted by date ascending", { sortBy: "date", sortOrder: "asc" }],
      ["sorted by person, grouped by log", { groupBy: "log", sortBy: "person", sortOrder: "asc" }],
      ["per-entity visits sorted by rating", { visitSortBy: "rating", visitSortOrder: "asc" }],
      ["per-entity visits sorted by date ascending", { visitSortBy: "date", visitSortOrder: "asc" }],
      [
        "a keyword combined with a category and a rating floor",
        { q: "dune", category: "movie", ratingMin: 3 },
      ],
    ];

    it.each(cases)("agrees with %s", (_name, query) => {
      expect(local.search(fx.snap, query)).toEqual(serverSearch(fx.db, query));
    });
  });

  describe("gallery", () => {
    it("agrees on the unfiltered first page", () => {
      expect(local.getGallery(fx.snap, {})).toEqual(listGalleryPhotos(fx.db, {}));
    });

    it("agrees on a small page and its cursor", () => {
      expect(local.getGallery(fx.snap, { limit: 2 })).toEqual(listGalleryPhotos(fx.db, { limit: 2 }));
    });

    it("agrees while paging all the way through", () => {
      let cursor: number | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const serverPage = listGalleryPhotos(fx.db, { limit: 2, cursor });
        expect(local.getGallery(fx.snap, { limit: 2, cursor })).toEqual(serverPage);
        if (serverPage.nextCursor === null) return;
        cursor = serverPage.nextCursor;
      }
      throw new Error("gallery paging did not terminate");
    });

    it("agrees when scoped to a person", () => {
      for (const person of fx.snap.entities.filter((e) => e.category === "person")) {
        expect(local.getGallery(fx.snap, { personId: person.id })).toEqual(
          listGalleryPhotos(fx.db, { personId: person.id }),
        );
      }
    });

    it("agrees when scoped to an album", () => {
      for (const album of fx.snap.albums) {
        expect(local.getGallery(fx.snap, { albumId: album.id })).toEqual(
          listGalleryPhotos(fx.db, { albumId: album.id }),
        );
      }
    });
  });

  describe("calendar", () => {
    const ranges: [string, string][] = [
      ["2026-09-01", "2026-09-30"],
      ["2026-08-24", "2026-10-04"],
      ["2026-01-01", "2026-12-31"],
      ["2025-01-01", "2027-12-31"],
      ["2026-02-01", "2026-02-28"],
      ["2028-02-01", "2028-02-29"],
      ["2030-01-01", "2030-01-31"],
    ];

    it.each(ranges)("agrees over %s..%s", (from, to) => {
      expect(local.getCalendarRange(fx.snap, from, to)).toEqual(serverCalendar(fx.db, from, to));
    });
  });

  describe("home widgets", () => {
    it("agrees on upcoming important dates", () => {
      expect(local.getUpcomingImportantDates(fx.snap, TODAY)).toEqual(
        serverImportantDates(fx.db, TODAY),
      );
    });

    it("agrees on upcoming events", () => {
      expect(local.getUpcomingEvents(fx.snap, TODAY)).toEqual(serverUpcomingEvents(fx.db, TODAY));
    });

    it("agrees on both widgets across a range of days", () => {
      for (let offset = -400; offset <= 400; offset += 37) {
        const day = new Date(TODAY);
        day.setUTCDate(day.getUTCDate() + offset);
        expect(local.getUpcomingImportantDates(fx.snap, day)).toEqual(
          serverImportantDates(fx.db, day),
        );
        expect(local.getUpcomingEvents(fx.snap, day)).toEqual(serverUpcomingEvents(fx.db, day));
      }
    });
  });

  describe("albums", () => {
    it("agrees on the album list", () => {
      expect(local.listAlbums(fx.snap)).toEqual(serverListAlbums(fx.db));
    });

    it("agrees on each album's detail", () => {
      for (const album of fx.snap.albums) {
        expect(local.getAlbum(fx.snap, album.id)).toEqual(getAlbumById(fx.db, album.id));
      }
    });
  });

  describe("entity notes", () => {
    it("agrees for every entity", () => {
      for (const entity of fx.snap.entities) {
        expect(local.listEntityNotes(fx.snap, entity.id)).toEqual(
          serverListNotes(fx.db, entity.id),
        );
      }
    });
  });

  describe("entity and person detail", () => {
    it("agrees on every loggable entity", () => {
      const loggable = fx.snap.entities.filter((e) => e.category !== "person");
      expect(loggable.length).toBeGreaterThan(0);
      for (const entity of loggable) {
        const { type, ...actual } = local.getEntityDetail(fx.snap, entity.id) as never as {
          type: string;
        } & Record<string, unknown>;
        expect(type).toBe("entity");
        expect(actual).toEqual(getEntityWithLogs(fx.db, entity.id));
      }
    });

    it("agrees on every person profile", () => {
      const people = fx.snap.entities.filter((e) => e.category === "person");
      expect(people.length).toBeGreaterThan(0);
      for (const person of people) {
        const { type, ...actual } = local.getEntityDetail(fx.snap, person.id) as never as {
          type: string;
        } & Record<string, unknown>;
        expect(type).toBe("person");
        expect(actual).toEqual(getPersonProfile(fx.db, person.id));
      }
    });
  });

  describe("entity autocomplete", () => {
    it.each([
      ["movie", "du"],
      ["movie", ""],
      ["book", "the"],
      ["person", "a"],
      ["eating_out", "chip"],
      ["movie", "no-such-title"],
    ] as const)("agrees for %s / %s", (category, term) => {
      expect(local.searchEntitiesByTitle(fx.snap, category, term)).toEqual(
        serverAutocomplete(fx.db, category, term),
      );
    });
  });
});
