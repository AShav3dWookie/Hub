import type { Category } from "../categories.js";
import type {
  AlbumSearchResult,
  EntityWithLogsDTO,
  LogDTO,
  LogWithEntityDTO,
  PersonRef,
  PersonSearchResult,
  SearchQuery,
  SortOrder,
} from "../types.js";
import { matchesTokens, tokenizeQuery, type MatchMode } from "../search.js";

/**
 * Every ordering and filtering decision the search makes, shared by the server's
 * `searchService` and the offline client's query layer.
 *
 * Neither side fetches through this module — the server runs SQL, the client walks its
 * snapshot — but both must reach the same answer, so all the rules live here.
 */

/** Options with every default resolved, so both sides start from the same values. */
export interface ResolvedSearchOptions {
  groupBy: "entity" | "log";
  sortBy: "date" | "title" | "rating" | "person";
  sortOrder: SortOrder;
  visitSortBy: "date" | "rating" | "person";
  visitSortOrder: SortOrder;
  qMode: MatchMode;
  tokens: string[];
}

export function resolveSearchOptions(query: SearchQuery): ResolvedSearchOptions {
  return {
    groupBy: query.groupBy ?? "entity",
    sortBy: query.sortBy ?? "date",
    sortOrder: query.sortOrder ?? "desc",
    visitSortBy: query.visitSortBy ?? "date",
    visitSortOrder: query.visitSortOrder ?? "desc",
    qMode: query.qMode ?? "all",
    tokens: query.q ? tokenizeQuery(query.q) : [],
  };
}

/** Ascending/descending comparator over a directly comparable key. */
export function comparator(order: SortOrder = "desc") {
  return (a: number | string, b: number | string) => {
    if (a === b) return 0;
    const result = a < b ? -1 : 1;
    return order === "asc" ? result : -result;
  };
}

/** The tagged people of a log as one name-sorted, comma-joined string, for "sort by person". */
export function peopleLabel(people: readonly PersonRef[]): string {
  return people
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

// ---- candidate filtering ----------------------------------------------------

export interface SearchEntityRow {
  category: Category;
  author: string | null;
  releaseYear: number | null;
}

/**
 * Whether an entity survives the entity-level filters: the category tab, the author substring
 * and the release-year bounds. Person entities are excluded unless explicitly asked for,
 * because they carry no logs of their own.
 *
 * The author test is a case-insensitive substring match on both sides. The server must not
 * narrow this in SQL instead: `LIKE` is only case-insensitive for ASCII, so a SQL prefilter
 * would quietly return fewer rows than the offline client for an accented author.
 */
export function entityMatchesFilters(entity: SearchEntityRow, query: SearchQuery): boolean {
  if (query.category ? entity.category !== query.category : entity.category === "person") {
    return false;
  }
  if (query.authorContains) {
    const author = (entity.author ?? "").toLowerCase();
    if (!author.includes(query.authorContains.toLowerCase())) return false;
  }
  if (query.releaseYearMin != null) {
    if (entity.releaseYear == null || entity.releaseYear < query.releaseYearMin) return false;
  }
  if (query.releaseYearMax != null) {
    if (entity.releaseYear == null || entity.releaseYear > query.releaseYearMax) return false;
  }
  return true;
}

export interface SearchLogRow {
  date: string;
  rating: number | null;
  notes: string | null;
}

/**
 * Whether a log survives the log-level filters: date range, rating range and the keyword,
 * which is matched against the entity title, the log's notes and every tagged person's name.
 */
export function logMatchesFilters(
  log: SearchLogRow,
  context: { entityTitle: string; peopleNames: readonly string[] },
  query: SearchQuery,
  options: Pick<ResolvedSearchOptions, "tokens" | "qMode">,
): boolean {
  if (query.dateFrom && log.date < query.dateFrom) return false;
  if (query.dateTo && log.date > query.dateTo) return false;
  if (query.ratingMin != null && (log.rating == null || log.rating < query.ratingMin)) return false;
  if (query.ratingMax != null && (log.rating == null || log.rating > query.ratingMax)) return false;
  if (options.tokens.length > 0) {
    const haystack = [context.entityTitle, log.notes ?? "", ...context.peopleNames].join(" ");
    if (!matchesTokens(haystack, options.tokens, options.qMode)) return false;
  }
  return true;
}

// ---- ordering ---------------------------------------------------------------

/**
 * Every sort below ends with an ascending id tie-break.
 *
 * Without one the order of tied rows falls back to the order they arrived in, and the server
 * (SQL row order) and the offline client (snapshot order) do not arrive in the same order. That
 * made "sort by person" return a different arrangement online and offline whenever several logs
 * shared a sort key, which is common — every log with nobody tagged has the same empty label.
 */

/** Sort flat log results in place, by the top-level sort selection. */
export function sortLogResults(
  logs: LogWithEntityDTO[],
  sortBy: ResolvedSearchOptions["sortBy"],
  sortOrder: SortOrder,
): LogWithEntityDTO[] {
  const cmp = comparator(sortOrder);
  return logs.sort((a, b) => {
    switch (sortBy) {
      case "title":
        return cmp(a.entity.title.toLowerCase(), b.entity.title.toLowerCase()) || a.id - b.id;
      case "rating":
        return cmp(a.rating ?? 0, b.rating ?? 0) || a.id - b.id;
      case "person":
        return (
          cmp(peopleLabel(a.people).toLowerCase(), peopleLabel(b.people).toLowerCase()) ||
          a.id - b.id
        );
      case "date":
      default:
        return cmp(a.date, b.date) || a.id - b.id;
    }
  });
}

/** Sort one entity's own logs in place, by the per-entity "visit" sort selection. */
export function sortEntityLogs(
  logs: LogDTO[],
  visitSortBy: ResolvedSearchOptions["visitSortBy"],
  visitSortOrder: SortOrder,
): LogDTO[] {
  const cmp = comparator(visitSortOrder);
  return logs.sort((a, b) => {
    switch (visitSortBy) {
      case "rating":
        return cmp(a.rating ?? 0, b.rating ?? 0) || a.id - b.id;
      case "person":
        return (
          cmp(peopleLabel(a.people).toLowerCase(), peopleLabel(b.people).toLowerCase()) ||
          a.id - b.id
        );
      case "date":
      default:
        return cmp(a.date, b.date) || a.id - b.id;
    }
  });
}

/** Sort grouped entity results in place, by the top-level sort selection. */
export function sortEntityResults(
  entities: EntityWithLogsDTO[],
  sortBy: ResolvedSearchOptions["sortBy"],
  sortOrder: SortOrder,
): EntityWithLogsDTO[] {
  const cmp = comparator(sortOrder);
  return entities.sort((a, b) => {
    switch (sortBy) {
      case "title":
        return cmp(a.title.toLowerCase(), b.title.toLowerCase()) || a.id - b.id;
      case "rating":
        return cmp(a.averageRating ?? 0, b.averageRating ?? 0) || a.id - b.id;
      case "date":
      default:
        return cmp(a.latestDate ?? "", b.latestDate ?? "") || a.id - b.id;
    }
  });
}

// ---- aggregates -------------------------------------------------------------

export interface EntityLogSummary {
  visitCount: number;
  averageRating: number | null;
  latestDate: string | null;
}

/**
 * The per-entity roll-up shown on a grouped result. `averageRating` counts only rated logs and
 * is null when none are rated, so an unrated category never averages to zero.
 */
export function summariseEntityLogs(logs: readonly LogDTO[]): EntityLogSummary {
  const rated = logs.filter((l) => l.rating != null);
  const averageRating =
    rated.length > 0 ? rated.reduce((sum, l) => sum + (l.rating ?? 0), 0) / rated.length : null;
  const latestDate = logs.reduce<string | null>(
    (max, l) => (max === null || l.date > max ? l.date : max),
    null,
  );
  return { visitCount: logs.length, averageRating, latestDate };
}

// ---- the people and album side-lists ----------------------------------------

/**
 * People and albums are searched by name alongside the main results, but only when the query
 * asks for them: a keyword search includes them, and their own filter tab lists them in full.
 * A different category filter suppresses them entirely.
 */
export function shouldSearchSideList(
  query: SearchQuery,
  tokens: readonly string[],
  tab: "person" | "album",
): boolean {
  if (query.category && query.category !== tab) return false;
  if (tokens.length === 0 && query.category !== tab) return false;
  return true;
}

/** Filter a side-list by the keyword, or pass it through when browsing its tab with no keyword. */
export function matchByTitle<T>(
  rows: readonly T[],
  titleOf: (row: T) => string,
  options: Pick<ResolvedSearchOptions, "tokens" | "qMode">,
): T[] {
  if (options.tokens.length === 0) return [...rows];
  return rows.filter((row) => matchesTokens(titleOf(row), options.tokens, options.qMode));
}

export const byPersonName = (a: PersonSearchResult, b: PersonSearchResult) =>
  a.name.localeCompare(b.name);

export const byAlbumTitle = (a: AlbumSearchResult, b: AlbumSearchResult) =>
  a.title.localeCompare(b.title);
