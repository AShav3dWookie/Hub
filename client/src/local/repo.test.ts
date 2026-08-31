import { describe, it, expect, beforeEach } from "vitest";
import { repo, LocalNotFoundError } from "./repo.js";
import { getMeta, META_SYNC_CURSOR } from "./db.js";
import {
  makeAlbum,
  makeEntity,
  makeLog,
  makeNote,
  makePerson,
  makePhoto,
  resetFixtureCounters,
  seedLocalDb,
} from "../test/seedLocalDb.js";

describe("repo (reads from IndexedDB)", () => {
  beforeEach(() => resetFixtureCounters());

  it("serves entity detail, search and gallery from the seeded replica", async () => {
    const alice = makePerson("Alice");
    const heat = makeEntity({ title: "Heat", category: "movie" });
    const log = makeLog({ entityId: heat.id, date: "2024-05-05", rating: 5, peopleIds: [alice.id] });
    const photo = makePhoto({ logId: log.id });
    log.photoIds = [photo.id];
    await seedLocalDb({ entities: [alice, heat], logs: [log], photos: [photo], cursor: "12" });

    const detail = await repo.getEntityDetail(heat.id);
    expect(detail).toMatchObject({ type: "entity", title: "Heat", visitCount: 1 });

    const search = await repo.search({ q: "heat", groupBy: "log" });
    expect(search.logs?.[0]).toMatchObject({ id: log.id, rating: 5 });

    const gallery = await repo.getGallery();
    expect(gallery.photos.map((p) => p.id)).toEqual([photo.id]);

    const person = await repo.getEntityDetail(alice.id);
    expect(person).toMatchObject({ type: "person" });

    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("12");
  });

  it("albums, notes, calendar and home widgets all resolve", async () => {
    const alice = makePerson("Alice");
    const diner = makeEntity({ title: "Joe's", category: "eating_out" });
    const meal = makeLog({ entityId: diner.id, date: "2026-06-10" });
    const album = makeAlbum({ title: "June", eventLogIds: [meal.id], personIds: [alice.id] });
    const note = makeNote({
      entityId: alice.id,
      category: "important_date",
      tag: "Birthday",
      eventDate: "1990-06-10",
      body: "card",
    });
    await seedLocalDb({ entities: [alice, diner], logs: [meal], albums: [album], notes: [note] });

    expect((await repo.listAlbums()).map((a) => a.title)).toEqual(["June"]);
    expect((await repo.getAlbum(album.id)).events).toHaveLength(1);
    expect((await repo.listEntityNotes(alice.id)).map((n) => n.tag)).toEqual(["Birthday"]);
    expect((await repo.getCalendarRange("2026-06-01", "2026-06-30")).items.length).toBeGreaterThan(0);
    expect((await repo.getUpcomingImportantDates()).today.concat((await repo.getUpcomingImportantDates()).next7Days).length).toBeGreaterThanOrEqual(0);
  });

  it("propagates LocalNotFoundError for missing rows", async () => {
    await expect(repo.getEntityDetail(404)).rejects.toBeInstanceOf(LocalNotFoundError);
    await expect(repo.getAlbum(404)).rejects.toBeInstanceOf(LocalNotFoundError);
  });

  it("hides expired auto-delete appointments without a network call", async () => {
    const appt = makeEntity({ category: "appointment", title: "Appts" });
    const expired = makeLog({
      entityId: appt.id,
      autoDelete: true,
      date: "2000-01-01",
      createdAt: "1999-12-01T00:00:00.000Z",
    });
    await seedLocalDb({ entities: [appt], logs: [expired] });

    const detail = await repo.getEntityDetail(appt.id);
    expect(detail).toMatchObject({ type: "entity", visitCount: 0 });
  });
});
