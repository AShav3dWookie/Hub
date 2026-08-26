import { ne, eq, inArray, and, like, gte, lte } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { entities, logs, logPeople } from "../db/schema.js";
import { tokenizeQuery, matchesTokens } from "@logger/shared";
import type {
  SearchQuery,
  SearchResponse,
  EntityWithLogsDTO,
  LogWithEntityDTO,
  LogDTO,
  PersonRef,
  EntitySummary,
  PersonSearchResult,
} from "@logger/shared";

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

/**
 * Person entities matched directly by name (or listed in full when browsing the "person" category
 * with no keyword). Suppressed when a specific non-person category filter is active.
 */
function searchPeople(db: AppDb, query: SearchQuery, queryTokens: string[]): PersonSearchResult[] {
  if (query.category && query.category !== "person") return [];
  if (queryTokens.length === 0 && query.category !== "person") return [];

  const qMode = query.qMode ?? "all";
  const personRows = db.select().from(entities).where(eq(entities.category, "person")).all();
  const matches =
    queryTokens.length > 0 ? personRows.filter((row) => matchesTokens(row.title, queryTokens, qMode)) : personRows;

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
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function search(db: AppDb, query: SearchQuery): SearchResponse {
  const groupBy = query.groupBy ?? "entity";
  const sortBy = query.sortBy ?? "date";
  const sortOrder = query.sortOrder ?? "desc";
  const visitSortBy = query.visitSortBy ?? "date";
  const visitSortOrder = query.visitSortOrder ?? "desc";
  const qMode = query.qMode ?? "all";
  const queryTokens = query.q ? tokenizeQuery(query.q) : [];
  const people = searchPeople(db, query, queryTokens);

  // 1. Candidate entities (loggable categories only; person entities aren't logged directly).
  const entityConditions = [
    query.category ? eq(entities.category, query.category) : ne(entities.category, "person"),
  ];
  if (query.authorContains) {
    entityConditions.push(like(entities.author, `%${query.authorContains}%`));
  }
  if (query.releaseYearMin != null) {
    entityConditions.push(gte(entities.releaseYear, query.releaseYearMin));
  }
  if (query.releaseYearMax != null) {
    entityConditions.push(lte(entities.releaseYear, query.releaseYearMax));
  }
  const entityRows = db
    .select()
    .from(entities)
    .where(and(...entityConditions))
    .all();
  const entityById = new Map(entityRows.map((e) => [e.id, e]));

  if (entityById.size === 0) {
    return groupBy === "log" ? { groupBy, logs: [], people } : { groupBy, entities: [], people };
  }

  // 2. Load logs for those entities + their tagged people.
  const entityIds = [...entityById.keys()];
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

  // 3. Apply log-level filters: date range, rating range, keyword (title + notes + tagged people).
  let filteredLogs = logRows.filter((row) => {
    if (query.dateFrom && row.date < query.dateFrom) return false;
    if (query.dateTo && row.date > query.dateTo) return false;
    if (query.ratingMin != null && (row.rating == null || row.rating < query.ratingMin))
      return false;
    if (query.ratingMax != null && (row.rating == null || row.rating > query.ratingMax))
      return false;
    if (queryTokens.length > 0) {
      const entity = entityById.get(row.entityId);
      const people = peopleByLog.get(row.id) ?? [];
      const haystack = [entity?.title ?? "", row.notes ?? "", ...people.map((p) => p.name)].join(" ");
      if (!matchesTokens(haystack, queryTokens, qMode)) return false;
    }
    return true;
  });

  const survivingEntityIds = new Set(filteredLogs.map((l) => l.entityId));
  for (const id of entityIds) {
    if (!survivingEntityIds.has(id)) entityById.delete(id);
  }

  if (groupBy === "log") {
    const flat: LogWithEntityDTO[] = filteredLogs.map((row) => {
      const entity = entityById.get(row.entityId)!;
      return toLogWithEntity(row, peopleByLog.get(row.id) ?? [], entity);
    });

    flat.sort((a, b) => {
      switch (sortBy) {
        case "title":
          return comparator(sortOrder)(a.entity.title.toLowerCase(), b.entity.title.toLowerCase());
        case "rating":
          return comparator(sortOrder)(a.rating ?? 0, b.rating ?? 0);
        case "person":
          return comparator(sortOrder)(peopleLabel(a.people).toLowerCase(), peopleLabel(b.people).toLowerCase());
        case "date":
        default:
          return comparator(sortOrder)(a.date, b.date);
      }
    });

    return { groupBy, logs: flat, people };
  }

  // groupBy === "entity"
  const logsByEntity = new Map<number, LogDTO[]>();
  for (const row of filteredLogs) {
    const dto: LogDTO = {
      id: row.id,
      entityId: row.entityId,
      rating: row.rating,
      date: row.date,
      notes: row.notes,
      people: peopleByLog.get(row.id) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    const list = logsByEntity.get(row.entityId) ?? [];
    list.push(dto);
    logsByEntity.set(row.entityId, list);
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
        case "date":
        default:
          return comparator(visitSortOrder)(a.date, b.date);
      }
    });

    const ratedLogs = entityLogs.filter((l) => l.rating != null);
    const averageRating =
      ratedLogs.length > 0
        ? ratedLogs.reduce((sum, l) => sum + (l.rating ?? 0), 0) / ratedLogs.length
        : null;
    const latestDate = entityLogs.reduce<string | null>(
      (max, l) => (max === null || l.date > max ? l.date : max),
      null,
    );

    return {
      id: entity.id,
      category: entity.category,
      title: entity.title,
      createdAt: entity.createdAt,
      releaseYear: entity.releaseYear,
      author: entity.author,
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
      case "date":
      default:
        return comparator(sortOrder)(a.latestDate ?? "", b.latestDate ?? "");
    }
  });

  return { groupBy, entities: entityResults, people };
}

function toLogWithEntity(
  row: typeof logs.$inferSelect,
  people: PersonRef[],
  entity: typeof entities.$inferSelect,
): LogWithEntityDTO {
  const entitySummary: EntitySummary = {
    id: entity.id,
    category: entity.category,
    title: entity.title,
    createdAt: entity.createdAt,
    releaseYear: entity.releaseYear,
    author: entity.author,
  };
  return {
    id: row.id,
    entityId: row.entityId,
    rating: row.rating,
    date: row.date,
    notes: row.notes,
    people,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    entity: entitySummary,
  };
}
