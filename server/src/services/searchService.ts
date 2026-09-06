import { ne, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs, logPeople, albums, albumEvents } from "../db/schema.js";
import { toLogDTO, toLogWithEntity } from "./logService.js";
import { toEntitySummary } from "./entityService.js";
import {
  byAlbumTitle,
  byPersonName,
  entityMatchesFilters,
  logMatchesFilters,
  matchByTitle,
  resolveSearchOptions,
  shouldSearchSideList,
  sortEntityLogs,
  sortEntityResults,
  sortLogResults,
  summariseEntityLogs,
  type ResolvedSearchOptions,
} from "@logger/shared";
import type {
  SearchQuery,
  SearchResponse,
  EntityWithLogsDTO,
  LogWithEntityDTO,
  LogDTO,
  PersonRef,
  PersonSearchResult,
  AlbumSearchResult,
} from "@logger/shared";

type EntityRow = typeof entities.$inferSelect;
type LogRow = typeof logs.$inferSelect;

/**
 * Keyword and filter search over entities, their logs, and the people/album side-lists.
 *
 * Every filtering and ordering decision is made by the shared rules in `@logger/shared`, so the
 * offline client's query layer produces byte-identical results from its local replica. The SQL
 * here only decides what has to be read.
 */

/**
 * Person entities matched directly by name (or listed in full when browsing the "person"
 * category with no keyword). Suppressed when a specific non-person category filter is active.
 */
function searchPeople(
  db: AppDb,
  query: SearchQuery,
  options: ResolvedSearchOptions,
): PersonSearchResult[] {
  if (!shouldSearchSideList(query, options.tokens, "person")) return [];

  const personRows = db.select().from(entities).where(eq(entities.category, "person")).all();
  const matches = matchByTitle(personRows, (row) => row.title, options);
  if (matches.length === 0) return [];

  const personIds = matches.map((p) => p.id);
  const appearanceRows = db
    .select({ personEntityId: logPeople.personEntityId })
    .from(logPeople)
    .where(inArray(logPeople.personEntityId, personIds))
    .all();

  const appearanceCounts = new Map<number, number>();
  for (const row of appearanceRows) {
    appearanceCounts.set(row.personEntityId, (appearanceCounts.get(row.personEntityId) ?? 0) + 1);
  }

  return matches
    .map((row) => ({
      id: row.id,
      name: row.title,
      appearanceCount: appearanceCounts.get(row.id) ?? 0,
    }))
    .sort(byPersonName);
}

/**
 * Albums matched directly by title (or listed in full when the "album" filter tab is active with
 * no keyword). Suppressed when a specific non-album category filter is set — mirrors searchPeople.
 */
function searchAlbums(
  db: AppDb,
  query: SearchQuery,
  options: ResolvedSearchOptions,
): AlbumSearchResult[] {
  if (!shouldSearchSideList(query, options.tokens, "album")) return [];

  const albumRows = db.select().from(albums).all();
  const matches = matchByTitle(albumRows, (row) => row.title, options);
  if (matches.length === 0) return [];

  const albumIds = matches.map((a) => a.id);
  const countRows = db
    .select({ albumId: albumEvents.albumId, count: sql<number>`count(*)` })
    .from(albumEvents)
    .where(inArray(albumEvents.albumId, albumIds))
    .groupBy(albumEvents.albumId)
    .all();
  const eventCounts = new Map(countRows.map((r) => [r.albumId, Number(r.count)]));

  return matches
    .map((row) => ({
      id: row.id,
      title: row.title,
      eventCount: eventCounts.get(row.id) ?? 0,
    }))
    .sort(byAlbumTitle);
}

/**
 * Entities that survive the entity-level filters.
 *
 * Only the category is narrowed in SQL. The author and release-year tests are applied by the
 * shared predicate instead: SQL `LIKE` is case-insensitive for ASCII only, so narrowing the
 * author here would return fewer rows than the offline client for an accented name.
 */
function loadCandidateEntities(db: AppDb, query: SearchQuery): Map<number, EntityRow> {
  // "album" is a filter tab, not an entity category, and callers return early for it. Excluding
  // it here keeps this function correct on its own rather than relying on that.
  const category = query.category && query.category !== "album" ? query.category : undefined;

  const rows = db
    .select()
    .from(entities)
    .where(category ? eq(entities.category, category) : ne(entities.category, "person"))
    .all();

  const byId = new Map<number, EntityRow>();
  for (const row of rows) {
    if (entityMatchesFilters(row, query)) byId.set(row.id, row);
  }
  return byId;
}

/** Every log belonging to the candidate entities, with each log's tagged people. */
function loadLogsWithPeople(
  db: AppDb,
  entityIds: number[],
): { logRows: LogRow[]; peopleByLog: Map<number, PersonRef[]> } {
  const logRows = db.select().from(logs).where(inArray(logs.entityId, entityIds)).all();
  const logIds = logRows.map((l) => l.id);

  const peopleByLog = new Map<number, PersonRef[]>();
  if (logIds.length > 0) {
    const peopleRows = db
      .select({ logId: logPeople.logId, id: entities.id, name: entities.title })
      .from(logPeople)
      .innerJoin(entities, eq(logPeople.personEntityId, entities.id))
      .where(inArray(logPeople.logId, logIds))
      .all();
    for (const row of peopleRows) {
      const list = peopleByLog.get(row.logId) ?? [];
      list.push({ id: row.id, name: row.name });
      peopleByLog.set(row.logId, list);
    }
  }

  return { logRows, peopleByLog };
}

/**
 * Search results are built with `photos: []` and `albums: []` on purpose: a list view must never
 * trigger a per-log photo or album lookup. Only the entity-detail log list and the dedicated
 * gallery endpoint carry real ones.
 */
function buildLogGrouped(
  logRows: LogRow[],
  peopleByLog: Map<number, PersonRef[]>,
  entityById: Map<number, EntityRow>,
  options: ResolvedSearchOptions,
): LogWithEntityDTO[] {
  const flat = logRows.map((row) =>
    toLogWithEntity(row, peopleByLog.get(row.id) ?? [], entityById.get(row.entityId)!),
  );
  return sortLogResults(flat, options.sortBy, options.sortOrder);
}

function buildEntityGrouped(
  logRows: LogRow[],
  peopleByLog: Map<number, PersonRef[]>,
  entityById: Map<number, EntityRow>,
  options: ResolvedSearchOptions,
): EntityWithLogsDTO[] {
  const logsByEntity = new Map<number, LogDTO[]>();
  for (const row of logRows) {
    const list = logsByEntity.get(row.entityId) ?? [];
    list.push(toLogDTO(row, peopleByLog.get(row.id) ?? []));
    logsByEntity.set(row.entityId, list);
  }

  const results = [...entityById.values()].map((entity) => {
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

  return sortEntityResults(results, options.sortBy, options.sortOrder);
}

export function search(db: AppDb, query: SearchQuery): SearchResponse {
  const options = resolveSearchOptions(query);
  const { groupBy } = options;
  const people = searchPeople(db, query, options);
  const albumResults = searchAlbums(db, query, options);

  const emptyResults = (): SearchResponse =>
    groupBy === "log"
      ? { groupBy, logs: [], people, albums: albumResults }
      : { groupBy, entities: [], people, albums: albumResults };

  // The "album" filter tab is not a real category — it selects albums only, no entity/log results.
  if (query.category === "album") return emptyResults();

  const entityById = loadCandidateEntities(db, query);
  if (entityById.size === 0) return emptyResults();

  const { logRows, peopleByLog } = loadLogsWithPeople(db, [...entityById.keys()]);

  const filteredLogs = logRows.filter((row) =>
    logMatchesFilters(
      row,
      {
        entityTitle: entityById.get(row.entityId)?.title ?? "",
        peopleNames: (peopleByLog.get(row.id) ?? []).map((p) => p.name),
      },
      query,
      options,
    ),
  );

  // An entity with no surviving log drops out of the results entirely.
  const survivingEntityIds = new Set(filteredLogs.map((l) => l.entityId));
  for (const id of [...entityById.keys()]) {
    if (!survivingEntityIds.has(id)) entityById.delete(id);
  }

  return groupBy === "log"
    ? {
        groupBy,
        logs: buildLogGrouped(filteredLogs, peopleByLog, entityById, options),
        people,
        albums: albumResults,
      }
    : {
        groupBy,
        entities: buildEntityGrouped(filteredLogs, peopleByLog, entityById, options),
        people,
        albums: albumResults,
      };
}
