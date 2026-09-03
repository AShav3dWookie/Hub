/**
 * Offline counterparts of the server's read services, as pure functions over a
 * {@link LocalSnapshot}. Each returns the exact DTO shape its `/api` counterpart does, so
 * `repo.ts` can stand in for the network behind the existing TanStack Query keys with no
 * component changes.
 *
 * These no longer re-implement the server's rules. Every filtering, ordering, windowing and
 * paging decision comes from `@logger/shared/rules`, which the matching server service calls
 * too — so the two cannot drift apart. What stays here is only how rows are read out of the
 * local replica, which is genuinely different from the server's SQL.
 *
 * Counterparts:
 *   server/src/services/entityService.ts         → searchEntitiesByTitle
 *   server/src/services/entityDetailService.ts   → getEntityDetail (entity + person)
 *   server/src/services/searchService.ts         → search
 *   server/src/services/galleryService.ts        → getGallery
 *   server/src/services/albumService.ts          → listAlbums / getAlbum
 *   server/src/services/entityNotesService.ts    → listEntityNotes
 *   server/src/services/calendarService.ts       → getCalendarRange
 *   server/src/services/importantDatesService.ts → getUpcomingImportantDates
 *   server/src/services/upcomingEventsService.ts → getUpcomingEvents
 */
import {
  DEFAULT_GALLERY_LIMIT,
  EVENT_CATEGORIES,
  bucketImportantDates,
  bucketUpcomingEvents,
  buildCalendarRange,
  byAlbumTitle,
  byPersonName,
  entityMatchesFilters,
  isAfterCursor,
  logMatchesFilters,
  matchByTitle,
  mediaKindForMime,
  normalizeTitle,
  paginateByDescendingId,
  resolveSearchOptions,
  shouldSearchSideList,
  sortEntityLogs,
  sortEntityResults,
  sortLogResults,
  summariseEntityLogs,
  type AlbumDTO,
  type AlbumSummary,
  type AlbumSyncDTO,
  type CalendarRangeResponse,
  type Category,
  type EntityNoteDTO,
  type EntityNoteSyncDTO,
  type EntitySummary,
  type EntitySyncDTO,
  type EntityWithLogsDTO,
  type GalleryPhotoDTO,
  type GalleryResponse,
  type LoggableCategory,
  type LogDTO,
  type LogPhotoDTO,
  type LogSyncDTO,
  type LogWithEntityDTO,
  type PersonProfileDTO,
  type PersonRef,
  type PersonStats,
  type PhotoSyncDTO,
  type GalleryQuery,
  type SearchQuery,
  type SearchResponse,
  type UpcomingEventsResponse,
  type UpcomingImportantDatesResponse,
} from "@logger/shared";
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

type SearchOptions = ReturnType<typeof resolveSearchOptions>;

function searchPeople(snap: LocalSnapshot, query: SearchQuery, options: SearchOptions) {
  if (!shouldSearchSideList(query, options.tokens, "person")) return [];

  const people = snap.entities.filter((e) => e.category === "person");
  const matches = matchByTitle(people, (p) => p.title, options);
  if (matches.length === 0) return [];

  const appearanceCount = new Map<number, number>();
  for (const log of snap.logs) {
    for (const pid of log.peopleIds) {
      appearanceCount.set(pid, (appearanceCount.get(pid) ?? 0) + 1);
    }
  }

  return matches
    .map((p) => ({ id: p.id, name: p.title, appearanceCount: appearanceCount.get(p.id) ?? 0 }))
    .sort(byPersonName);
}

function searchAlbums(snap: LocalSnapshot, query: SearchQuery, options: SearchOptions) {
  if (!shouldSearchSideList(query, options.tokens, "album")) return [];

  const matches = matchByTitle(snap.albums, (a) => a.title, options);
  if (matches.length === 0) return [];

  return matches
    .map((a) => ({ id: a.id, title: a.title, eventCount: a.eventLogIds.length }))
    .sort(byAlbumTitle);
}

export function search(snap: LocalSnapshot, query: SearchQuery): SearchResponse {
  const options = resolveSearchOptions(query);
  const { groupBy } = options;
  const people = searchPeople(snap, query, options);
  const albums = searchAlbums(snap, query, options);

  const emptyResults = (): SearchResponse =>
    groupBy === "log"
      ? { groupBy, logs: [], people, albums }
      : { groupBy, entities: [], people, albums };

  // The "album" filter tab is not a real category — it selects albums only.
  if (query.category === "album") return emptyResults();

  const entityById = new Map<number, EntitySyncDTO>();
  for (const entity of snap.entities) {
    if (entityMatchesFilters(entity, query)) entityById.set(entity.id, entity);
  }
  if (entityById.size === 0) return emptyResults();

  const filteredLogs = snap.logs.filter((log) => {
    const entity = entityById.get(log.entityId);
    if (!entity) return false;
    return logMatchesFilters(
      log,
      {
        entityTitle: entity.title,
        peopleNames: peopleRefs(snap, log.peopleIds).map((p) => p.name),
      },
      query,
      options,
    );
  });

  // An entity with no surviving log drops out of the results entirely.
  const survivingEntityIds = new Set(filteredLogs.map((l) => l.entityId));
  for (const id of [...entityById.keys()]) {
    if (!survivingEntityIds.has(id)) entityById.delete(id);
  }

  if (groupBy === "log") {
    const flat: LogWithEntityDTO[] = filteredLogs.map((log) => ({
      ...toLogDTO(snap, log, false),
      entity: toEntitySummary(entityById.get(log.entityId)!),
    }));
    return {
      groupBy,
      logs: sortLogResults(flat, options.sortBy, options.sortOrder),
      people,
      albums,
    };
  }

  const logsByEntity = new Map<number, LogDTO[]>();
  for (const log of filteredLogs) {
    const list = logsByEntity.get(log.entityId) ?? [];
    list.push(toLogDTO(snap, log, false));
    logsByEntity.set(log.entityId, list);
  }

  const entityResults: EntityWithLogsDTO[] = [...entityById.values()].map((entity) => {
    const entityLogs = sortEntityLogs(
      logsByEntity.get(entity.id) ?? [],
      options.visitSortBy,
      options.visitSortOrder,
    );
    return {
      ...toEntitySummary(entity),
      logs: entityLogs,
      ...summariseEntityLogs(entityLogs),
    };
  });

  return {
    groupBy,
    entities: sortEntityResults(entityResults, options.sortBy, options.sortOrder),
    people,
    albums,
  };
}

// ---- gallery --------------------------------------------------------------

export function getGallery(snap: LocalSnapshot, query: GalleryQuery = {}): GalleryResponse {
  const limit = query.limit ?? DEFAULT_GALLERY_LIMIT;

  let photos = [...snap.photos].sort((a, b) => b.id - a.id);
  photos = photos.filter((p) => isAfterCursor(p.id, query.cursor));

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

  const { page, nextCursor } = paginateByDescendingId(photos, limit, (p) => p.id);

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

  return { photos: dtos, nextCursor };
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

export function getCalendarRange(
  snap: LocalSnapshot,
  from: string,
  to: string,
): CalendarRangeResponse {
  const logRows = [];
  for (const log of snap.logs) {
    const entity = snap.entityById.get(log.entityId);
    if (!entity) continue;
    logRows.push({
      logId: log.id,
      date: log.date,
      notes: log.notes,
      entityId: entity.id,
      title: entity.title,
      category: entity.category,
    });
  }

  const noteRows = [];
  for (const note of snap.notes) {
    const entity = snap.entityById.get(note.entityId);
    if (!entity) continue;
    noteRows.push({
      noteId: note.id,
      category: note.category,
      tag: note.tag,
      eventDate: note.eventDate,
      body: note.body,
      entityId: entity.id,
      entityName: entity.title,
      entityCategory: entity.category,
    });
  }

  return buildCalendarRange(logRows, noteRows, from, to);
}

// ---- home widgets --------------------------------------------------

export function getUpcomingImportantDates(
  snap: LocalSnapshot,
  today: Date = new Date(),
): UpcomingImportantDatesResponse {
  const rows = [];
  for (const note of snap.notes) {
    const entity = snap.entityById.get(note.entityId);
    if (!entity) continue;
    rows.push({
      noteId: note.id,
      entityId: note.entityId,
      entityName: entity.title,
      tag: note.tag,
      eventDate: note.eventDate,
      body: note.body,
      category: note.category,
    });
  }
  return bucketImportantDates(rows, today);
}

export function getUpcomingEvents(
  snap: LocalSnapshot,
  today: Date = new Date(),
): UpcomingEventsResponse {
  const rows = [];
  for (const log of snap.logs) {
    const entity = snap.entityById.get(log.entityId);
    if (!entity || !EVENT_CATEGORIES.includes(entity.category)) continue;
    rows.push({
      logId: log.id,
      entityId: log.entityId,
      entityTitle: entity.title,
      category: entity.category,
      date: log.date,
      notes: log.notes,
      createdAt: log.createdAt,
      people: peopleRefs(snap, log.peopleIds),
    });
  }
  return bucketUpcomingEvents(rows, today);
}
