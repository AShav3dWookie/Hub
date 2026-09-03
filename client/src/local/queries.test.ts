import { describe, it, expect, beforeEach } from "vitest";
import { buildSnapshot, type LocalSnapshot } from "./snapshot.js";
import * as q from "./queries.js";
import {
  makeAlbum,
  makeEntity,
  makeLog,
  makeNote,
  makePerson,
  makePhoto,
  resetFixtureCounters,
} from "../test/seedLocalDb.js";
import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  LogSyncDTO,
  PhotoSyncDTO,
} from "@logger/shared";

function snap(
  parts: {
    entities?: EntitySyncDTO[];
    logs?: LogSyncDTO[];
    photos?: PhotoSyncDTO[];
    albums?: AlbumSyncDTO[];
    notes?: EntityNoteSyncDTO[];
  },
  now = new Date("2026-06-15T12:00:00.000Z"),
): LocalSnapshot {
  return buildSnapshot(
    {
      entities: parts.entities ?? [],
      logs: parts.logs ?? [],
      photos: parts.photos ?? [],
      albums: parts.albums ?? [],
      notes: parts.notes ?? [],
    },
    now,
  );
}

beforeEach(() => resetFixtureCounters());

describe("searchEntitiesByTitle", () => {
  it("matches within a category, case/space-insensitively, title-sorted, capped", () => {
    const s = snap({
      entities: [
        makeEntity({ title: "The Bear", category: "tv" }),
        makeEntity({ title: "Bear Grylls Show", category: "tv" }),
        makeEntity({ title: "Bear", category: "movie" }),
      ],
    });
    expect(q.searchEntitiesByTitle(s, "tv", "  BEAR ").map((r) => r.title)).toEqual([
      "Bear Grylls Show",
      "The Bear",
    ]);
    expect(q.searchEntitiesByTitle(s, "tv", "bear", 1)).toHaveLength(1);
    expect(q.searchEntitiesByTitle(s, "movie", "bear").map((r) => r.title)).toEqual(["Bear"]);
  });
});

describe("getEntityDetail", () => {
  it("throws LocalNotFoundError for an unknown id", () => {
    expect(() => q.getEntityDetail(snap({}), 999)).toThrow(q.LocalNotFoundError);
  });

  it("returns an entity with logs newest-first, real photos, average rating", () => {
    const movie = makeEntity({ title: "Heat", category: "movie" });
    const p1 = makePhoto({ logId: 0 });
    const older = makeLog({ entityId: movie.id, date: "2024-01-01", rating: 3, photoIds: [p1.id] });
    p1.logId = older.id;
    const newer = makeLog({ entityId: movie.id, date: "2024-09-09", rating: 5 });
    const s = snap({ entities: [movie], logs: [older, newer], photos: [p1] });

    const detail = q.getEntityDetail(s, movie.id);
    expect(detail.type).toBe("entity");
    if (detail.type !== "entity") throw new Error("expected entity");
    expect(detail.logs.map((l) => l.date)).toEqual(["2024-09-09", "2024-01-01"]);
    expect(detail.visitCount).toBe(2);
    expect(detail.averageRating).toBe(4);
    expect(detail.latestDate).toBe("2024-09-09");
    expect(detail.logs[1].photos).toHaveLength(1);
    expect(detail.logs[1].photos[0].thumbnailUrl).toContain("_thumb");
  });

  it("derives photo.kind from the stored mime type", () => {
    const movie = makeEntity({ title: "Heat", category: "movie" });
    const img = makePhoto({ logId: 0, mimeType: "image/jpeg" });
    const vid = makePhoto({ logId: 0, mimeType: "video/mp4" });
    const log = makeLog({ entityId: movie.id, date: "2024-01-01", photoIds: [img.id, vid.id] });
    img.logId = log.id;
    vid.logId = log.id;
    const s = snap({ entities: [movie], logs: [log], photos: [img, vid] });

    const detail = q.getEntityDetail(s, movie.id);
    if (detail.type !== "entity") throw new Error("expected entity");
    expect(detail.logs[0].photos.map((p) => p.kind)).toEqual(["photo", "video"]);
  });

  it("returns a person profile with appearances and stats (photos omitted)", () => {
    const alice = makePerson("Alice");
    const bob = makePerson("Bob");
    const heat = makeEntity({ title: "Heat", category: "movie" });
    const dune = makeEntity({ title: "Dune", category: "movie" });
    const l1 = makeLog({ entityId: heat.id, date: "2024-02-02", peopleIds: [alice.id, bob.id] });
    const l2 = makeLog({ entityId: dune.id, date: "2024-05-05", peopleIds: [alice.id] });
    const s = snap({ entities: [alice, bob, heat, dune], logs: [l1, l2] });

    const detail = q.getEntityDetail(s, alice.id);
    if (detail.type !== "person") throw new Error("expected person");
    expect(detail.appearances.map((a) => a.date)).toEqual(["2024-05-05", "2024-02-02"]);
    expect(detail.appearances[0].photos).toEqual([]);
    expect(detail.stats.totalLogs).toBe(2);
    expect(detail.stats.favoriteCategory).toBe("movie");
    expect(detail.stats.mostFrequentCoPerson).toEqual({ id: bob.id, name: "Bob" });
  });
});

describe("search", () => {
  it("keyword-filters over title, notes and tagged people; groups by entity", () => {
    const alice = makePerson("Alice");
    const heat = makeEntity({ title: "Heat", category: "movie" });
    const dune = makeEntity({ title: "Dune", category: "movie" });
    const l1 = makeLog({ entityId: heat.id, date: "2024-01-01", peopleIds: [alice.id], rating: 4 });
    const l2 = makeLog({ entityId: dune.id, date: "2024-02-01", notes: "with Alice at home" });
    const s = snap({ entities: [alice, heat, dune], logs: [l1, l2] });

    const res = q.search(s, { q: "alice", groupBy: "entity" });
    expect(res.people?.map((p) => p.name)).toEqual(["Alice"]);
    expect(res.entities?.map((e) => e.title).sort()).toEqual(["Dune", "Heat"]);
  });

  it("applies date + rating filters and flat log grouping with sort", () => {
    const heat = makeEntity({ title: "Heat", category: "movie" });
    const logs = [
      makeLog({ entityId: heat.id, date: "2024-01-01", rating: 2 }),
      makeLog({ entityId: heat.id, date: "2024-06-01", rating: 5 }),
      makeLog({ entityId: heat.id, date: "2024-12-01", rating: 4 }),
    ];
    const s = snap({ entities: [heat], logs });

    const res = q.search(s, {
      groupBy: "log",
      dateFrom: "2024-03-01",
      ratingMin: 4,
      sortBy: "rating",
      sortOrder: "desc",
    });
    expect(res.logs?.map((l) => l.rating)).toEqual([5, 4]);
  });

  it("category=album returns only album matches", () => {
    const s = snap({ albums: [makeAlbum({ title: "Trip to Rome" }), makeAlbum({ title: "Ski" })] });
    const res = q.search(s, { category: "album", q: "rome" });
    expect(res.albums?.map((a) => a.title)).toEqual(["Trip to Rome"]);
    expect(res.entities).toEqual([]);
  });
});

describe("getGallery", () => {
  it("returns photos newest-id-first with cursor paging and log context", () => {
    const movie = makeEntity({ title: "Heat", category: "movie" });
    const log = makeLog({ entityId: movie.id, date: "2024-01-01" });
    const photos = [1, 2, 3, 4].map((n) =>
      makePhoto({ id: 100 + n, logId: log.id, rowSeq: 50 + n }),
    );
    log.photoIds = photos.map((p) => p.id);
    const s = snap({ entities: [movie], logs: [log], photos });

    const page1 = q.getGallery(s, { limit: 2 });
    expect(page1.photos.map((p) => p.id)).toEqual([104, 103]);
    expect(page1.nextCursor).toBe(103);
    expect(page1.photos[0].log).toMatchObject({ entityTitle: "Heat", category: "movie" });

    const page2 = q.getGallery(s, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.photos.map((p) => p.id)).toEqual([102, 101]);
    expect(page2.nextCursor).toBeNull();
  });

  it("orphan photos (no log) come back with log: null", () => {
    const s = snap({ photos: [makePhoto({ id: 7, logId: null })] });
    expect(q.getGallery(s).photos[0].log).toBeNull();
  });

  it("personId scope covers tagged-log photos and direct-album loose photos", () => {
    const alice = makePerson("Alice");
    const movie = makeEntity({ title: "Heat", category: "movie" });
    const taggedLog = makeLog({ entityId: movie.id, peopleIds: [alice.id] });
    const otherLog = makeLog({ entityId: movie.id, peopleIds: [] });
    const album = makeAlbum({ personIds: [alice.id] });
    const p1 = makePhoto({ id: 10, logId: taggedLog.id });
    const p2 = makePhoto({ id: 11, logId: otherLog.id });
    const p3 = makePhoto({ id: 12, albumId: album.id });
    const s = snap({
      entities: [alice, movie],
      logs: [taggedLog, otherLog],
      albums: [album],
      photos: [p1, p2, p3],
    });

    expect(q.getGallery(s, { personId: alice.id }).photos.map((p) => p.id).sort()).toEqual([10, 12]);
  });

  it("albumId scope covers loose photos and linked-event photos", () => {
    const movie = makeEntity({ title: "Heat", category: "movie" });
    const eventLog = makeLog({ entityId: movie.id });
    const album = makeAlbum({ eventLogIds: [eventLog.id] });
    const loose = makePhoto({ id: 20, albumId: album.id });
    const viaEvent = makePhoto({ id: 21, logId: eventLog.id });
    const unrelated = makePhoto({ id: 22 });
    const s = snap({ entities: [movie], logs: [eventLog], albums: [album], photos: [loose, viaEvent, unrelated] });

    expect(q.getGallery(s, { albumId: album.id }).photos.map((p) => p.id).sort()).toEqual([20, 21]);
  });
});

describe("albums", () => {
  it("listAlbums: newest-created first with event and photo counts", () => {
    const movie = makeEntity({ title: "Heat", category: "movie" });
    const eventLog = makeLog({ entityId: movie.id });
    const older = makeAlbum({ title: "Old", createdAt: "2024-01-01T00:00:00.000Z" });
    const newer = makeAlbum({
      title: "New",
      createdAt: "2024-09-01T00:00:00.000Z",
      eventLogIds: [eventLog.id],
    });
    const loose = makePhoto({ albumId: newer.id });
    const eventPhoto = makePhoto({ logId: eventLog.id });
    const s = snap({ entities: [movie], logs: [eventLog], albums: [older, newer], photos: [loose, eventPhoto] });

    const list = q.listAlbums(s);
    expect(list.map((a) => a.title)).toEqual(["New", "Old"]);
    expect(list[0]).toMatchObject({ eventCount: 1, photoCount: 2 });
  });

  it("getAlbum: events newest-first, people = direct ∪ tagged-on-events", () => {
    const alice = makePerson("Alice");
    const bob = makePerson("Bob");
    const movie = makeEntity({ title: "Heat", category: "movie" });
    const l1 = makeLog({ entityId: movie.id, date: "2024-02-01", peopleIds: [bob.id] });
    const l2 = makeLog({ entityId: movie.id, date: "2024-08-01", peopleIds: [] });
    const album = makeAlbum({ personIds: [alice.id], eventLogIds: [l1.id, l2.id] });
    const s = snap({ entities: [alice, bob, movie], logs: [l1, l2], albums: [album] });

    const dto = q.getAlbum(s, album.id);
    expect(dto.events.map((e) => e.date)).toEqual(["2024-08-01", "2024-02-01"]);
    expect(dto.directPersonIds).toEqual([alice.id]);
    expect(dto.people.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("getAlbum throws for an unknown id", () => {
    expect(() => q.getAlbum(snap({}), 123)).toThrow(q.LocalNotFoundError);
  });
});

describe("listEntityNotes", () => {
  it("newest-first by createdAt then id, scoped to the entity", () => {
    const person = makePerson("Alice");
    const n1 = makeNote({ entityId: person.id, body: "a", createdAt: "2024-01-01T00:00:00.000Z" });
    const n2 = makeNote({ entityId: person.id, body: "b", createdAt: "2024-05-01T00:00:00.000Z" });
    const other = makeNote({ entityId: 999, body: "x" });
    const s = snap({ entities: [person], notes: [n1, n2, other] });
    expect(q.listEntityNotes(s, person.id).map((n) => n.body)).toEqual(["b", "a"]);
  });
});

describe("getCalendarRange", () => {
  it("includes calendar-category logs and annual important-date occurrences, not movies", () => {
    const alice = makePerson("Alice");
    const restaurant = makeEntity({ title: "Din Tai Fung", category: "eating_out" });
    const movie = makeEntity({ title: "Dune", category: "movie" });
    const mealLog = makeLog({ entityId: restaurant.id, date: "2026-03-10" });
    const movieLog = makeLog({ entityId: movie.id, date: "2026-03-14" });
    const bday = makeNote({
      entityId: alice.id,
      category: "important_date",
      tag: "Birthday",
      eventDate: "1990-03-14",
      body: "card",
    });
    const s = snap({ entities: [alice, restaurant, movie], logs: [mealLog, movieLog], notes: [bday] });

    const res = q.getCalendarRange(s, "2026-03-01", "2026-03-31");
    expect(res.items.map((i) => `${i.kind}:${i.date}`)).toEqual([
      "log:2026-03-10",
      "important_date:2026-03-14",
    ]);
  });

  it("skips a Feb-29 birthday in non-leap years", () => {
    const alice = makePerson("Alice");
    const leap = makeNote({
      entityId: alice.id,
      category: "important_date",
      tag: "Anniversary",
      eventDate: "2000-02-29",
      body: "",
    });
    const s = snap({ entities: [alice], notes: [leap] });
    expect(q.getCalendarRange(s, "2025-02-01", "2025-02-28").items).toHaveLength(0);
    expect(q.getCalendarRange(s, "2028-02-01", "2028-02-29").items).toHaveLength(1);
  });
});

describe("home widgets", () => {
  const NOW = new Date("2026-06-15T12:00:00.000Z");

  it("getUpcomingImportantDates buckets by annual recurrence", () => {
    const alice = makePerson("Alice");
    const bob = makePerson("Bob");
    const today = makeNote({
      entityId: alice.id,
      category: "important_date",
      tag: "Birthday",
      eventDate: "1990-06-15",
      body: "",
    });
    const soon = makeNote({
      entityId: bob.id,
      category: "important_date",
      tag: "Birthday",
      eventDate: "1988-06-20",
      body: "",
    });
    const far = makeNote({
      entityId: bob.id,
      category: "important_date",
      tag: "Anniversary",
      eventDate: "2000-11-03",
      body: "",
    });
    const s = snap({ entities: [alice, bob], notes: [today, soon, far] }, NOW);

    const res = q.getUpcomingImportantDates(s, NOW);
    expect(res.today.map((e) => e.entityName)).toEqual(["Alice"]);
    expect(res.next7Days.map((e) => e.tag)).toEqual(["Birthday"]);
  });

  it("getUpcomingEvents surfaces planned-ahead future hang-outs, hides after-the-fact logs", () => {
    const alice = makePerson("Alice");
    const hangout = makeEntity({ title: "Mini golf", category: "hang_out" });
    const planned = makeLog({
      entityId: hangout.id,
      date: "2026-06-18",
      createdAt: "2026-06-01T00:00:00.000Z",
      peopleIds: [alice.id],
    });
    const afterTheFact = makeLog({
      entityId: hangout.id,
      date: "2026-06-17",
      createdAt: "2026-06-17T20:00:00.000Z",
    });
    const s = snap({ entities: [alice, hangout], logs: [planned, afterTheFact] }, NOW);

    const res = q.getUpcomingEvents(s, NOW);
    expect(res.next7Days.map((e) => e.date)).toEqual(["2026-06-18"]);
    expect(res.next7Days[0].people.map((p) => p.name)).toEqual(["Alice"]);
  });
});

describe("snapshot sweep integration", () => {
  it("expired auto-delete appointments are invisible to every query", () => {
    const appt = makeEntity({ category: "appointment", title: "Appts" });
    const expired = makeLog({
      entityId: appt.id,
      autoDelete: true,
      date: "2026-01-01",
      createdAt: "2025-12-01T00:00:00.000Z",
    });
    const s = snap({ entities: [appt], logs: [expired] }, new Date("2026-06-15T12:00:00.000Z"));

    expect(q.getEntityDetail(s, appt.id)).toMatchObject({ type: "entity", visitCount: 0 });
    expect(q.getCalendarRange(s, "2026-01-01", "2026-01-31").items).toHaveLength(0);
    expect(q.getUpcomingEvents(s).today).toHaveLength(0);
  });
});
