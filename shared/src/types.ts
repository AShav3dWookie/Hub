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
  /** Entity-level fields, set once at creation. Only present for categories that support them (see CATEGORY_FIELDS). */
  releaseYear: number | null;
  author: string | null;
}

/** A photo attached to a log. Only logs whose category has hasPeople can have photos (see CATEGORY_FIELDS). */
export interface LogPhotoDTO {
  id: number;
  /** The log this photo belongs to, or null if that log was deleted but the photo was kept (gallery orphan). */
  logId: number | null;
  /** Path to the full-size image, served under /api/photos. */
  url: string;
  /** Path to the server-generated thumbnail, served under /api/photos. */
  thumbnailUrl: string;
  originalName: string;
  createdAt: string;
}

/** A gallery photo: a LogPhotoDTO plus the event it's attached to (null once that log is deleted). */
export interface GalleryPhotoDTO extends LogPhotoDTO {
  log: {
    id: number;
    entityId: number;
    entityTitle: string;
    category: LoggableCategory;
    date: string;
  } | null;
}

/** Response for GET /api/gallery. */
export interface GalleryResponse {
  photos: GalleryPhotoDTO[];
  /** Pass as ?cursor= to fetch the next page; null when there are no more photos. */
  nextCursor: number | null;
}

export interface LogDTO {
  id: number;
  entityId: number;
  rating: number | null;
  date: string;
  notes: string | null;
  people: PersonRef[];
  /** Attached photos. Always [] for categories without hasPeople, and for summary/search views. */
  photos: LogPhotoDTO[];
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
  authorContains?: string;
  releaseYearMin?: number;
  releaseYearMax?: number;
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
  releaseYear?: number | null;
  author?: string | null;
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
  /** Entity-level fields, only used when creating a new entity (ignored when attaching to an existing one). */
  releaseYear?: number | null;
  author?: string | null;
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
  /** Short custom label, required for category "important_date" (e.g. "Birthday", "New job"). */
  tag: string | null;
  /** ISO date (YYYY-MM-DD) the tag refers to, required for category "important_date". Recurs annually by month+day. */
  eventDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntityNoteRequest {
  category?: NoteCategory;
  body: string;
  tag?: string | null;
  eventDate?: string | null;
}

export interface UpdateEntityNoteRequest {
  category?: NoteCategory;
  body: string;
  tag?: string | null;
  eventDate?: string | null;
}

/** A single important-date note surfaced on the home screen, with its parent person entity inlined. */
export interface ImportantDateEntry {
  noteId: number;
  entityId: number;
  entityName: string;
  tag: string;
  /** The original stored ISO date (YYYY-MM-DD); recurs annually by month+day. */
  eventDate: string;
  /** This year's (or next year's, if already passed) occurrence, as an ISO date (YYYY-MM-DD). */
  nextOccurrence: string;
  body: string;
}

/** Response for GET /api/important-dates/upcoming. */
export interface UpcomingImportantDatesResponse {
  today: ImportantDateEntry[];
  next7Days: ImportantDateEntry[];
}
