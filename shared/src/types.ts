import type { Category, LoggableCategory } from "./categories.js";
import type { MatchMode } from "./search.js";
import type { NoteCategory } from "./notes.js";

export interface PersonRef {
  id: number;
  name: string;
}

export interface EntitySummary {
  id: number;
  category: Category;
  title: string;
  createdAt: string;
}

export interface LogDTO {
  id: number;
  entityId: number;
  rating: number | null;
  date: string;
  notes: string | null;
  people: PersonRef[];
  createdAt: string;
  updatedAt: string;
}

/** A log with its parent entity's title/category inlined, used in flat search results and person appearances. */
export interface LogWithEntityDTO extends LogDTO {
  entity: EntitySummary;
}

/** Entity + all of its logs, used for the entity detail page and grouped search results. */
export interface EntityWithLogsDTO extends EntitySummary {
  logs: LogDTO[];
  visitCount: number;
  averageRating: number | null;
  latestDate: string | null;
}

export interface PersonStats {
  totalLogs: number;
  favoriteCategory: LoggableCategory | null;
  mostFrequentCoPerson: PersonRef | null;
}

/** Response for GET /api/entities/:id when the entity's category is "person". */
export interface PersonProfileDTO {
  entity: EntitySummary;
  appearances: LogWithEntityDTO[];
  stats: PersonStats;
}

export type SortBy = "date" | "title" | "rating" | "person";
export type SortOrder = "asc" | "desc";
export type VisitSortBy = "date" | "rating" | "person";
export type GroupBy = "entity" | "log";

export interface SearchQuery {
  q?: string;
  qMode?: MatchMode;
  category?: Category;
  dateFrom?: string;
  dateTo?: string;
  ratingMin?: number;
  ratingMax?: number;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  groupBy?: GroupBy;
  visitSortBy?: VisitSortBy;
  visitSortOrder?: SortOrder;
}

export interface SearchResponse {
  groupBy: GroupBy;
  entities?: EntityWithLogsDTO[];
  logs?: LogWithEntityDTO[];
  people?: PersonSearchResult[];
}

/** A person entity matched directly by name in a keyword search (or listed via a "person" category filter). */
export interface PersonSearchResult {
  id: number;
  name: string;
  appearanceCount: number;
}

export interface CreateEntityRequest {
  category: Category;
  title: string;
}

export interface PersonTagInput {
  /** Existing person entity id */
  id?: number;
  /** Name to auto-create-on-tag if id is not provided */
  name?: string;
}

export interface CreateLogRequest {
  /** Attach to an existing entity */
  entityId?: number;
  /** Or create a new entity (category must be loggable, not "person") */
  category?: LoggableCategory;
  title?: string;
  rating: number | null;
  date: string;
  notes: string | null;
  people: PersonTagInput[];
}

export interface UpdateLogRequest {
  rating: number | null;
  date: string;
  notes: string | null;
  people: PersonTagInput[];
}

/** A free-form note attached to any entity (currently only surfaced in the UI for people). */
export interface EntityNoteDTO {
  id: number;
  entityId: number;
  category: NoteCategory;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntityNoteRequest {
  category?: NoteCategory;
  body: string;
}

export interface UpdateEntityNoteRequest {
  category?: NoteCategory;
  body: string;
}
