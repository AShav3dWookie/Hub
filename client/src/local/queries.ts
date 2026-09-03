/**
 * Offline ports of the server's read services, as pure functions over a {@link LocalSnapshot}.
 * Each returns the exact DTO shape its `/api` counterpart does, so `repo.ts` can stand in for
 * the network behind the existing TanStack Query keys with no component changes.
 *
 * Ported 1:1 from (and kept in step with):
 *   server/src/services/entityService.ts      → searchEntitiesByTitle
 *   server/src/services/entityDetailService.ts → getEntityDetail (entity + person)
 *   server/src/services/searchService.ts       → search
 *   server/src/services/galleryService.ts      → getGallery
 *   server/src/services/albumService.ts        → listAlbums / getAlbum
 *   server/src/services/entityNotesService.ts  → listEntityNotes
 *   server/src/services/calendarService.ts     → getCalendarRange
 *   server/src/services/importantDatesService.ts → getUpcomingImportantDates
 *   server/src/services/upcomingEventsService.ts → getUpcomingEvents
 */
import {
  matchesTokens,
  mediaKindForMime,
  normalizeTitle,
  tokenizeQuery,
  type AlbumDTO,
  type AlbumSummary,
  type AlbumSyncDTO,
  type CalendarItem,
  type CalendarRangeResponse,
  type Category,
  type EntityNoteDTO,
  type EntityNoteSyncDTO,
  type EntitySummary,
  type EntitySyncDTO,
  type EntityWithLogsDTO,
  type GalleryPhotoDTO,
  type GalleryResponse,
  type ImportantDateEntry,
  type LoggableCategory,
  type LogDTO,
  type LogPhotoDTO,
  type LogSyncDTO,
  type LogWithEntityDTO,
  type PersonProfileDTO,
  type PersonRef,
  type PersonStats,
  type PhotoSyncDTO,
  type SearchQuery,
  type SearchResponse,
  type UpcomingEventEntry,
  type UpcomingEventsResponse,
  type UpcomingImportantDatesResponse,
} from "@logger/shared";
import { daysInMonth } from "../lib/calendar.js";
import type { LocalSnapshot } from "./snapshot.js";

export class LocalNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalNotFoundError";
  }
}

// ---- shared row → DTO mappers ------------------------------------------------

function toEntitySummary(e: EntitySyncDTO): EntitySummary {
  return {
    id: e.id,
    category: e.category,
    title: e.title,
    createdAt: e.createdAt,
    releaseYear: e.releaseYear,
    author: e.author,
  };
}

function toLogPhotoDTO(p: PhotoSyncDTO): LogPhotoDTO {
  return {
    id: p.id,
    logId: p.logId,
    kind: mediaKindForMime(p.mimeType),
    url: p.url,
    thumbnailUrl: p.thumbnailUrl,
    originalName: p.originalName,
    createdAt: p.createdAt,
  };
}

function peopleRefs(snap: LocalSnapshot, peopleIds: number[]): PersonRef[] {
  const refs: PersonRef[] = [];
  for (const id of peopleIds) {
    const e = snap.entityById.get(id);
    if (e) refs.push({ id: e.id, name: e.title });
  }
  return refs;
}

/**
 * A full `LogDTO`. `withPhotos` mirrors the server split: only the entity-detail log list
 * carries real photos/albums; search results and person appearances use `[]`.
 */
function toLogDTO(snap: LocalSnapshot, log: LogSyncDTO, withPhotos: boolean): LogDTO {
  const photos = withPhotos
    ? log.photoIds
        .map((id) => snap.photoById.get(id))
        .filter((p): p is PhotoSyncDTO => p != null)
        .map(toLogPhotoDTO)
    : [];
  const albums = withPhotos
    ? log.albumIds
        .map((id) => snap.albumById.get(id))
        .filter((a): a is AlbumSyncDTO => a != null)
        .map((a) => ({ id: a.id, title: a.title }))
    : [];
  return {
    id: log.id,
    entityId: log.entityId,
    rating: log.rating,
    date: log.date,
    notes: log.notes,
    people: peopleRefs(snap, log.peopleIds),
    photos,
    albums,
    autoDelete: log.autoDelete,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}

function toEntityNoteDTO(n: EntityNoteSyncDTO): EntityNoteDTO {
  return {
    id: n.id,
    entityId: n.entityId,
    category: n.category,
    body: n.body,
    tag: n.tag,
    eventDate: n.eventDate,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

// ---- entity autocomplete ----------------------------------------------------

export interface EntityAutocompleteResult {
  id: number;
  title: string;
  category: Category;
}

export function searchEntitiesByTitle(
  snap: LocalSnapshot,
  category: Category,
  query: string,
  limit = 10,
): EntityAutocompleteResult[] {
  const nq = normalizeTitle(query);
  return snap.entities
    .filter((e) => e.category === category && e.normalizedTitle.includes(nq))
    .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
    .slice(0, limit)
    .map((e) => ({ id: e.id, title: e.title, category: e.category }));
}

// ---- entity / person detail ----------------------------------------------------

export type EntityDetail =
  | ({ type: "entity" } & EntityWithLogsDTO)
  | ({ type: "person" } & PersonProfileDTO);

function logsForEntity(snap: LocalSnapshot, entityId: number): LogSyncDTO[] {
  return snap.logs.filter((l) => l.entityId === entityId);
}

export function getEntityDetail(snap: LocalSnapshot, id: number): EntityDetail {
  const entity = snap.entityById.get(id);
  if (!entity) throw new LocalNotFoundError(`Entity ${id} not found`);

  if (entity.category === "person") {
    return { type: "person", ...getPersonProfile(snap, entity) };
  }

  const logs = logsForEntity(snap, id)
    .map((l) => toLogDTO(snap, l, true))
    .sort((a, b) => b.date.localeCompare(a.date));
  const rated = logs.filter((l) => l.rating != null);
  const averageRating =
    rated.length > 0 ? rated.reduce((s, l) => s + (l.rating ?? 0), 0) / rated.length : null;

  return {
    type: "entity",
    ...toEntitySummary(entity),
    logs,
    visitCount: logs.length,
    averageRating,
    latestDate: logs.length > 0 ? logs[0].date : null,
  };
}

function getPersonProfile(snap: LocalSnapshot, entity: EntitySyncDTO): PersonProfileDTO {
  const appearances: LogWithEntityDTO[] = snap.logs
    .filter((l) => l.peopleIds.includes(entity.id))
    .map((l) => {
      const parent = snap.entityById.get(l.entityId);
      if (!parent) return null;
      return { ...toLogDTO(snap, l, false), entity: toEntitySummary(parent) };
    })
    .filter((x): x is LogWithEntityDTO => x !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  return { entity: toEntitySummary(entity), appearances, stats: personStats(entity.id, appearances) };
}

function personStats(personId: number, appearances: LogWithEntityDTO[]): PersonStats {
  const categoryCounts = new Map<LoggableCategory, number>();
  for (const log of appearances) {
    if (log.entity.category === "person") continue;
    const c = log.entity.category as LoggableCategory;
    categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1);
  }
  let favoriteCategory: LoggableCategory | null = null;
  let maxCount = 0;
  for (const [c, n] of categoryCounts) {
    if (n > maxCount) {
      maxCount = n;
      favoriteCategory = c;
    }
  }

  const coCounts = new Map<number, { name: string; count: number }>();
  for (const log of appearances) {
    for (const p of log.people) {
      if (p.id === personId) continue;
      const existing = coCounts.get(p.id);
      coCounts.set(p.id, { name: p.name, count: (existing?.count ?? 0) + 1 });
    }
  }
  let mostFrequentCoPerson: PersonRef | null = null;
  let maxCo = 0;
  for (const [id, { name, count }] of coCounts) {
    if (count > maxCo) {
      maxCo = count;
      mostFrequentCoPerson = { id, name };
    }
  }

  return { totalLogs: appearances.length, favoriteCategory, mostFrequentCoPerson };
}

// ---- search ----------------------------------------------------------------

function comparator(order: "asc" | "desc" = "desc") {
  return (a: number | string, b: number | string) => {
    if (a === b) return 0;
    const result = a < b ? -1 : 1;
    return order === "asc" ? result : -result;
  };
}

function peopleLabel(people: PersonRef[]): string {
  return people
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

function searchPeople(snap: LocalSnapshot, query: SearchQuery, tokens: string[]) {
  if (query.category && query.category !== "person") return [];
  if (tokens.length === 0 && query.category !== "person") return [];
  const qMode = query.qMode ?? "all";

  const people = snap.entities.filter((e) => e.category === "person");
  const matches =
    tokens.length > 0 ? people.filter((p) => matchesTokens(p.title, tokens, qMode)) : people;
  if (matches.length === 0) return [];

  const appearanceCount = new Map<number, number>();
  for (const log of snap.logs) {
    for (const pid of log.peopleIds) {
      appearanceCount.set(pid, (appearanceCount.get(pid) ?? 0) + 1);
    }
  }

  return matches
    .map((p) => ({ id: p.id, name: p.title, appearanceCount: appearanceCount.get(p.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function searchAlbums(snap: LocalSnapshot, query: SearchQuery, tokens: string[]) {
  if (query.category && query.category !== "album") return [];
  if (tokens.length === 0 && query.category !== "album") return [];
  const qMode = query.qMode ?? "all";

  const matches =
    tokens.length > 0
      ? snap.albums.filter((a) => matchesTokens(a.title, tokens, qMode))
      : snap.albums;
  if (matches.length === 0) return [];

  return matches
    .map((a) => ({ id: a.id, title: a.title, eventCount: a.eventLogIds.length }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function search(snap: LocalSnapshot, query: SearchQuery): SearchResponse {
  const groupBy = query.groupBy ?? "entity";
  const sortBy = query.sortBy ?? "date";
  const sortOrder = query.sortOrder ?? "desc";
  const visitSortBy = query.visitSortBy ?? "date";
  const visitSortOrder = query.visitSortOrder ?? "desc";
  const qMode = query.qMode ?? "all";
  const tokens = query.q ? tokenizeQuery(query.q) : [];
  const people = searchPeople(snap, query, tokens);
  const albums = searchAlbums(snap, query, tokens);

  if (query.category === "album") {
    return groupBy === "log"
      ? { groupBy, logs: [], people, albums }
      : { groupBy, entities: [], people, albums };
  }

  const entityById = new Map<number, EntitySyncDTO>();
  for (const e of snap.entities) {
    if (query.category ? e.category !== query.category : e.category === "person") continue;
    if (query.authorContains && !(e.author ?? "").toLowerCase().includes(query.authorContains.toLowerCase()))
      continue;
    if (query.releaseYearMin != null && (e.releaseYear == null || e.releaseYear < query.releaseYearMin))
      continue;
    if (query.releaseYearMax != null && (e.releaseYear == null || e.releaseYear > query.releaseYearMax))
      continue;
    entityById.set(e.id, e);
  }

  if (entityById.size === 0) {
    return groupBy === "log"
      ? { groupBy, logs: [], people, albums }
      : { groupBy, entities: [], people, albums };
  }

  const candidateLogs = snap.logs.filter((l) => entityById.has(l.entityId));

  const filteredLogs = candidateLogs.filter((log) => {
    if (query.dateFrom && log.date < query.dateFrom) return false;
    if (query.dateTo && log.date > query.dateTo) return false;
    if (query.ratingMin != null && (log.rating == null || log.rating < query.ratingMin)) return false;
    if (query.ratingMax != null && (log.rating == null || log.rating > query.ratingMax)) return false;
    if (tokens.length > 0) {
      const entity = entityById.get(log.entityId);
      const names = peopleRefs(snap, log.peopleIds).map((p) => p.name);
      const haystack = [entity?.title ?? "", log.notes ?? "", ...names].join(" ");
      if (!matchesTokens(haystack, tokens, qMode)) return false;
    }
    return true;
  });

  const survivingEntityIds = new Set(filteredLogs.map((l) => l.entityId));
  for (const id of [...entityById.keys()]) {
    if (!survivingEntityIds.has(id)) entityById.delete(id);
  }

  if (groupBy === "log") {
    const flat: LogWithEntityDTO[] = filteredLogs.map((log) => ({
      ...toLogDTO(snap, log, false),
      entity: toEntitySummary(entityById.get(log.entityId)!),
    }));
    flat.sort((a, b) => {
      switch (sortBy) {
        case "title":
          return comparator(sortOrder)(a.entity.title.toLowerCase(), b.entity.title.toLowerCase());
        case "rating":
          return comparator(sortOrder)(a.rating ?? 0, b.rating ?? 0);
        case "person":
          return comparator(sortOrder)(
            peopleLabel(a.people).toLowerCase(),
            peopleLabel(b.people).toLowerCase(),
          );
        default:
          return comparator(sortOrder)(a.date, b.date);
      }
    });
    return { groupBy, logs: flat, people, albums };
  }

  const logsByEntity = new Map<number, LogDTO[]>();
  for (const log of filteredLogs) {
    const list = logsByEntity.get(log.entityId) ?? [];
    list.push(toLogDTO(snap, log, false));
    logsByEntity.set(log.entityId, list);
  }

  const entityResults: EntityWithLogsDTO[] = [...entityById.values()].map((entity) => {
    const entityLogs = logsByEntity.get(entity.id) ?? [];
    entityLogs.sort((a, b) => {
      switch (visitSortBy) {
        case "rating":
          return comparator(visitSortOrder)(a.rating ?? 0, b.rating ?? 0);
        case "person":
          return comparator(visitSortOrder)(
            peopleLabel(a.people).toLowerCase(),
            peopleLabel(b.people).toLowerCase(),
          );
        default:
          return comparator(visitSortOrder)(a.date, b.date);
      }
    });
    const rated = entityLogs.filter((l) => l.rating != null);
    const averageRating =
      rated.length > 0 ? rated.reduce((s, l) => s + (l.rating ?? 0), 0) / rated.length : null;
    const latestDate = entityLogs.reduce<string | null>(
      (max, l) => (max === null || l.date > max ? l.date : max),
      null,
    );
    return {
      ...toEntitySummary(entity),
      logs: entityLogs,
      visitCount: entityLogs.length,
      averageRating,
      latestDate,
    };
  });

  entityResults.sort((a, b) => {
    switch (sortBy) {
      case "title":
        return comparator(sortOrder)(a.title.toLowerCase(), b.title.toLowerCase());
      case "rating":
        return comparator(sortOrder)(a.averageRating ?? 0, b.averageRating ?? 0);
      default:
        return comparator(sortOrder)(a.latestDate ?? "", b.latestDate ?? "");
    }
  });

  return { groupBy, entities: entityResults, people, albums };
}

// ---- gallery --------------------------------------------------------------

export const DEFAULT_GALLERY_LIMIT = 50;

export interface GalleryQuery {
  cursor?: number;
  limit?: number;
  personId?: number;
  albumId?: number;
}

export function getGallery(snap: LocalSnapshot, query: GalleryQuery = {}): GalleryResponse {
  const limit = query.limit ?? DEFAULT_GALLERY_LIMIT;

  let photos = [...snap.photos].sort((a, b) => b.id - a.id);
  if (query.cursor != null) photos = photos.filter((p) => p.id < query.cursor!);

  if (query.personId != null) {
    const person = query.personId;
    photos = photos.filter((p) => {
      const taggedOnLog = p.logId != null && snap.logById.get(p.logId)?.peopleIds.includes(person);
      const looseInDirectAlbum =
        p.albumId != null && snap.albumById.get(p.albumId)?.personIds.includes(person);
      return Boolean(taggedOnLog || looseInDirectAlbum);
    });
  } else if (query.albumId != null) {
    const album = snap.albumById.get(query.albumId);
    const linkedLogIds = new Set(album?.eventLogIds ?? []);
    photos = photos.filter(
      (p) => p.albumId === query.albumId || (p.logId != null && linkedLogIds.has(p.logId)),
    );
  }

  const hasMore = photos.length > limit;
  const page = hasMore ? photos.slice(0, limit) : photos;

  const dtos: GalleryPhotoDTO[] = page.map((p) => {
    const log = p.logId != null ? snap.logById.get(p.logId) : undefined;
    const entity = log ? snap.entityById.get(log.entityId) : undefined;
    return {
      ...toLogPhotoDTO(p),
      log:
        log && entity
          ? {
              id: log.id,
              entityId: log.entityId,
              entityTitle: entity.title,
              category: entity.category as LoggableCategory,
              date: log.date,
            }
          : null,
    };
  });

  return { photos: dtos, nextCursor: hasMore ? dtos[dtos.length - 1].id : null };
}

// ---- albums -------------------------------------------------------------

function countAlbumPhotos(snap: LocalSnapshot, album: AlbumSyncDTO): number {
  const linked = new Set(album.eventLogIds);
  return snap.photos.filter(
    (p) => p.albumId === album.id || (p.logId != null && linked.has(p.logId)),
  ).length;
}

function toAlbumSummary(snap: LocalSnapshot, a: AlbumSyncDTO): AlbumSummary {
  return {
    id: a.id,
    title: a.title,
    notes: a.notes,
    dateStart: a.dateStart,
    dateEnd: a.dateEnd,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    eventCount: a.eventLogIds.length,
    photoCount: countAlbumPhotos(snap, a),
  };
}

export function listAlbums(snap: LocalSnapshot): AlbumSummary[] {
  return snap.albums
    .map((a) => toAlbumSummary(snap, a))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.id - x.id);
}

export function getAlbum(snap: LocalSnapshot, id: number): AlbumDTO {
  const album = snap.albumById.get(id);
  if (!album) throw new LocalNotFoundError(`Album ${id} not found`);

  const events: LogWithEntityDTO[] = album.eventLogIds
    .map((logId) => {
      const log = snap.logById.get(logId);
      const entity = log ? snap.entityById.get(log.entityId) : undefined;
      if (!log || !entity) return null;
      return { ...toLogDTO(snap, log, false), entity: toEntitySummary(entity) };
    })
    .filter((x): x is LogWithEntityDTO => x !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  const peopleById = new Map<number, PersonRef>();
  for (const pid of album.personIds) {
    const e = snap.entityById.get(pid);
    if (e) peopleById.set(e.id, { id: e.id, name: e.title });
  }
  for (const logId of album.eventLogIds) {
    for (const ref of peopleRefs(snap, snap.logById.get(logId)?.peopleIds ?? [])) {
      if (!peopleById.has(ref.id)) peopleById.set(ref.id, ref);
    }
  }

  return {
    ...toAlbumSummary(snap, album),
    events,
    people: [...peopleById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    directPersonIds: [...album.personIds],
  };
}

// ---- entity notes ------------------------------------------------------

export function listEntityNotes(snap: LocalSnapshot, entityId: number): EntityNoteDTO[] {
  if (!snap.entityById.has(entityId)) throw new LocalNotFoundError(`Entity ${entityId} not found`);
  return snap.notes
    .filter((n) => n.entityId === entityId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .map(toEntityNoteDTO);
}

// ---- calendar -------------------------------------------------------

const CALENDAR_LOG_CATEGORIES: Category[] = ["eating_out", "hang_out", "appointment"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function getCalendarRange(
  snap: LocalSnapshot,
  from: string,
  to: string,
): CalendarRangeResponse {
  const items: CalendarItem[] = [];

  for (const log of snap.logs) {
    if (log.date < from || log.date > to) continue;
    const entity = snap.entityById.get(log.entityId);
    if (!entity || !CALENDAR_LOG_CATEGORIES.includes(entity.category)) continue;
    items.push({
      date: log.date,
      kind: "log",
      category: entity.category as CalendarItem["category"],
      title: entity.title,
      notes: log.notes,
      entityId: entity.id,
      entityCategory: entity.category,
      logId: log.id,
    });
  }

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (const note of snap.notes) {
    if (note.category !== "important_date" || !note.tag || !note.eventDate) continue;
    const entity = snap.entityById.get(note.entityId);
    if (!entity) continue;
    const [, mm, dd] = note.eventDate.slice(0, 10).split("-").map(Number);
    if (!mm || !dd) continue;
    for (let year = fromYear; year <= toYear; year++) {
      if (dd > daysInMonth(year, mm)) continue;
      const iso = `${year}-${pad2(mm)}-${pad2(dd)}`;
      if (iso < from || iso > to) continue;
      items.push({
        date: iso,
        kind: "important_date",
        category: "important_date",
        title: entity.title,
        notes: note.body || null,
        entityId: entity.id,
        entityCategory: entity.category,
        tag: note.tag,
        noteId: note.id,
      });
    }
  }

  items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.title.localeCompare(b.title) ||
      a.kind.localeCompare(b.kind) ||
      (a.logId ?? a.noteId ?? 0) - (b.logId ?? b.noteId ?? 0),
  );

  return { from, to, items };
}

// ---- home widgets --------------------------------------------------

function atMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextOccurrence(eventDate: string, today: Date): Date {
  const [, month, day] = eventDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
  if (candidate.getTime() < today.getTime()) {
    return new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
  }
  return candidate;
}

export function getUpcomingImportantDates(
  snap: LocalSnapshot,
  today: Date = new Date(),
): UpcomingImportantDatesResponse {
  const todayUTC = atMidnightUTC(today);
  const todayStr = toISODate(todayUTC);
  const weekEnd = new Date(todayUTC);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const todayEntries: ImportantDateEntry[] = [];
  const next7: ImportantDateEntry[] = [];

  for (const note of snap.notes) {
    if (note.category !== "important_date" || !note.tag || !note.eventDate) continue;
    const entity = snap.entityById.get(note.entityId);
    if (!entity) continue;
    const occurrence = nextOccurrence(note.eventDate, todayUTC);
    const occurrenceISO = toISODate(occurrence);
    const entry: ImportantDateEntry = {
      noteId: note.id,
      entityId: note.entityId,
      entityName: entity.title,
      tag: note.tag,
      eventDate: note.eventDate,
      nextOccurrence: occurrenceISO,
      body: note.body,
    };
    if (occurrenceISO === todayStr) todayEntries.push(entry);
    else if (occurrence.getTime() > todayUTC.getTime() && occurrence.getTime() <= weekEnd.getTime())
      next7.push(entry);
  }

  todayEntries.sort((a, b) => a.entityName.localeCompare(b.entityName));
  next7.sort(
    (a, b) =>
      a.nextOccurrence.localeCompare(b.nextOccurrence) || a.entityName.localeCompare(b.entityName),
  );
  return { today: todayEntries, next7Days: next7 };
}

const EVENT_CATEGORIES: Category[] = ["hang_out", "appointment"];

export function getUpcomingEvents(
  snap: LocalSnapshot,
  today: Date = new Date(),
): UpcomingEventsResponse {
  const todayStr = toISODate(atMidnightUTC(today));
  const weekEndStr = toISODate(
    (() => {
      const d = atMidnightUTC(today);
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    })(),
  );

  const todayEntries: UpcomingEventEntry[] = [];
  const next7: UpcomingEventEntry[] = [];

  for (const log of snap.logs) {
    const entity = snap.entityById.get(log.entityId);
    if (!entity || !EVENT_CATEGORIES.includes(entity.category)) continue;
    if (log.createdAt.slice(0, 10) >= log.date) continue; // logged after the fact → history
    const entry: UpcomingEventEntry = {
      logId: log.id,
      entityId: log.entityId,
      entityTitle: entity.title,
      category: entity.category as UpcomingEventEntry["category"],
      date: log.date,
      notes: log.notes,
      people: peopleRefs(snap, log.peopleIds),
    };
    if (log.date === todayStr) todayEntries.push(entry);
    else if (log.date > todayStr && log.date <= weekEndStr) next7.push(entry);
  }

  const byDateThenTitle = (a: UpcomingEventEntry, b: UpcomingEventEntry) =>
    a.date.localeCompare(b.date) || a.entityTitle.localeCompare(b.entityTitle);
  todayEntries.sort(byDateThenTitle);
  next7.sort(byDateThenTitle);
  return { today: todayEntries, next7Days: next7 };
}
