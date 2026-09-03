import { createTestDb } from "../../server/src/testUtils/testDb.js";
import type { AppDb } from "../../server/src/db/client.js";
import { logPhotos } from "../../server/src/db/schema.js";
import { createBareEntity } from "../../server/src/services/entityService.js";
import { createLog } from "../../server/src/services/logService.js";
import { createEntityNote } from "../../server/src/services/entityNotesService.js";
import { createAlbum, addAlbumEvent } from "../../server/src/services/albumService.js";
import { getChanges } from "../../server/src/services/syncService.js";
import { buildSnapshot, type LocalSnapshot } from "../../client/src/local/snapshot.js";
import type {
  AlbumSyncDTO,
  EntityNoteSyncDTO,
  EntitySyncDTO,
  LogSyncDTO,
  PhotoSyncDTO,
} from "@logger/shared";

/**
 * A fixed "today" so every windowed assertion (upcoming events, important dates) is
 * deterministic regardless of when the suite runs.
 */
export const TODAY = new Date("2026-09-03T12:00:00.000Z");

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOffset = (days: number) => {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

export interface ParityFixture {
  db: AppDb;
  snap: LocalSnapshot;
  cleanup: () => void;
}

/**
 * Drain the whole change-feed into the shape `buildSnapshot` takes.
 *
 * This is the real bridge between the two sides: the server emits its state as sync DTOs, and
 * the offline client builds its replica from exactly those. Paging is followed to the end so a
 * fixture larger than one sync window still produces a complete snapshot.
 */
export function snapshotFromServer(db: AppDb, now: Date = TODAY): LocalSnapshot {
  const entities: EntitySyncDTO[] = [];
  const logs: LogSyncDTO[] = [];
  const photos: PhotoSyncDTO[] = [];
  const albums: AlbumSyncDTO[] = [];
  const notes: EntityNoteSyncDTO[] = [];

  let since = 0;
  for (let guard = 0; guard < 100; guard++) {
    const page = getChanges(db, { since });
    entities.push(...page.changes.entities);
    logs.push(...page.changes.logs);
    photos.push(...page.changes.photos);
    albums.push(...page.changes.albums);
    notes.push(...page.changes.entityNotes);
    // The feed takes a numeric cursor but reports the next one as a string, because that is
    // how it travels over the wire.
    since = Number(page.nextCursor);
    if (!page.hasMore) break;
  }

  return buildSnapshot({ entities, logs, photos, albums, notes }, now);
}

/** Insert a photo row directly. `row_seq` is trigger-assigned, so it syncs like any other row. */
function attachPhoto(
  db: AppDb,
  opts: { logId?: number; albumId?: number; name: string; mimeType?: string },
): number {
  const row = db
    .insert(logPhotos)
    .values({
      logId: opts.logId ?? null,
      albumId: opts.albumId ?? null,
      filename: `${opts.name}.jpg`,
      thumbnailFilename: `${opts.name}_thumb.webp`,
      originalName: `${opts.name}.jpg`,
      mimeType: opts.mimeType ?? "image/jpeg",
      size: 1024,
    })
    .returning()
    .get();
  return row.id;
}

/**
 * A dataset broad enough to exercise every shared read path: several categories, rated and
 * unrated logs, tagged people, an album with linked events and loose photos, notes of both
 * categories, past and future events, and a photo whose log is later deleted.
 */
export function createParityFixture(): ParityFixture {
  const { db, cleanup } = createTestDb();

  const ada = createBareEntity(db, "person", "Ada Lovelace");
  const zoe = createBareEntity(db, "person", "Zoe Zhang");
  const mo = createBareEntity(db, "person", "Mo Farah");

  // Movies: rated, people-tagged, photo-bearing.
  const blade = createLog(db, {
    category: "movie",
    title: "Blade Runner 2049",
    releaseYear: 2017,
    rating: 5,
    date: "2026-01-15",
    notes: "stunning cinematography",
    people: [{ id: ada.id }, { id: zoe.id }],
  });
  const dune = createLog(db, {
    category: "movie",
    title: "Dune",
    releaseYear: 2021,
    rating: 4,
    date: "2025-11-02",
    notes: null,
    people: [{ id: ada.id }],
  });
  // A second visit to the same entity, so per-entity aggregates have something to average.
  createLog(db, {
    entityId: dune.entityId,
    rating: 2,
    date: "2026-02-20",
    notes: "less good on rewatch",
    people: [],
  });
  // An unrated movie, so averageRating has a null case to get right.
  createLog(db, {
    category: "movie",
    title: "Arrival",
    releaseYear: 2016,
    rating: null,
    date: "2024-07-07",
    notes: null,
    people: [{ id: mo.id }],
  });

  // Eating out: calendar category, people, photos.
  const chipotle = createLog(db, {
    category: "eating_out",
    title: "Chipotle",
    rating: 3,
    date: "2026-08-30",
    notes: "quick lunch with Zoe",
    people: [{ id: zoe.id }],
  });

  // Books and games: year granularity, author filter.
  createLog(db, {
    category: "book",
    title: "The Dispossessed",
    author: "Ursula K. Le Guin",
    rating: 5,
    date: "2025-01-01",
    notes: null,
    people: [],
  });
  createLog(db, {
    category: "book",
    title: "Germinal",
    author: "Émile Zola",
    rating: 4,
    date: "2024-01-01",
    notes: null,
    people: [],
  });
  createLog(db, {
    category: "game",
    title: "Outer Wilds",
    releaseYear: 2019,
    rating: 5,
    date: "2023-01-01",
    notes: null,
    people: [],
  });
  createLog(db, {
    category: "tv",
    title: "Severance",
    rating: 4,
    date: "2026-01-01",
    notes: null,
    people: [],
  });

  // Events: one today, one inside the week, one just outside it, one already past, and one
  // logged after the fact so the "planned ahead" rule has something to exclude.
  const bowling = createLog(db, {
    category: "hang_out",
    title: "Bowling night",
    rating: null,
    date: dayOffset(0),
    notes: "lane 4",
    people: [{ id: ada.id }, { id: mo.id }],
  });
  createLog(db, {
    category: "hang_out",
    title: "Picnic",
    rating: null,
    date: dayOffset(4),
    notes: null,
    people: [{ id: zoe.id }],
  });
  createLog(db, {
    category: "hang_out",
    title: "Too far out",
    rating: null,
    date: dayOffset(30),
    notes: null,
    people: [],
  });
  createLog(db, {
    category: "appointment",
    title: "Dentist",
    rating: null,
    date: dayOffset(2),
    notes: "upper left",
    people: [],
    autoDelete: false,
  });
  createLog(db, {
    category: "appointment",
    title: "Past appointment",
    rating: null,
    date: dayOffset(-10),
    notes: null,
    people: [],
    autoDelete: false,
  });

  // Notes: important dates on both sides of the window, plus an ordinary note.
  createEntityNote(db, ada.id, {
    category: "important_date",
    body: "",
    tag: "Birthday",
    eventDate: "1990-09-03",
  });
  createEntityNote(db, zoe.id, {
    category: "important_date",
    body: "ring her",
    tag: "Birthday",
    eventDate: "1988-09-06",
  });
  createEntityNote(db, mo.id, {
    category: "important_date",
    body: "",
    tag: "Anniversary",
    eventDate: "2001-02-29",
  });
  createEntityNote(db, ada.id, { category: "general", body: "prefers window seats" });

  // An album with a linked event, a directly-added person and a loose photo.
  const album = createAlbum(db, {
    title: "Rome trip",
    notes: "spring",
    dateStart: "2026-04-01",
    dateEnd: "2026-04-08",
    people: [{ id: mo.id }],
    eventLogIds: [],
  });
  addAlbumEvent(db, album.id, chipotle.id);

  attachPhoto(db, { logId: blade.id, name: "blade-1" });
  attachPhoto(db, { logId: blade.id, name: "blade-2", mimeType: "video/mp4" });
  attachPhoto(db, { logId: chipotle.id, name: "chipotle-1" });
  attachPhoto(db, { logId: bowling.id, name: "bowling-1" });
  attachPhoto(db, { albumId: album.id, name: "rome-loose" });

  return { db, snap: snapshotFromServer(db), cleanup };
}
