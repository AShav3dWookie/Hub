/**
 * Hardcoded category list for v1. Movie/TV/EatingOut/Book/Game are "loggable"
 * categories (they support repeated Log entries). Person is special: it has no
 * logs of its own, just an entity record, and is tagged onto other logs.
 */
export const CATEGORIES = [
  "movie",
  "tv",
  "eating_out",
  "book",
  "game",
  "person",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const LOGGABLE_CATEGORIES = [
  "movie",
  "tv",
  "eating_out",
  "book",
  "game",
] as const;

export type LoggableCategory = (typeof LOGGABLE_CATEGORIES)[number];

export function isLoggableCategory(category: Category): category is LoggableCategory {
  return (LOGGABLE_CATEGORIES as readonly string[]).includes(category);
}

export interface CategoryMeta {
  category: Category;
  label: string;
  /** lucide-react icon component name, resolved client-side */
  icon: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  movie: { category: "movie", label: "Movie", icon: "Clapperboard" },
  tv: { category: "tv", label: "TV Show", icon: "Tv" },
  eating_out: { category: "eating_out", label: "Eating Out", icon: "UtensilsCrossed" },
  book: { category: "book", label: "Book", icon: "BookOpen" },
  game: { category: "game", label: "Game", icon: "Gamepad2" },
  person: { category: "person", label: "Person", icon: "User" },
};

/** Whether a loggable category's date field is a full day or a year-only granularity. */
export type DateGranularity = "day" | "year";

export interface CategoryFieldsConfig {
  /** Entity-level fields collected once at creation time (not editable afterward, for now). */
  hasReleaseYear: boolean;
  hasAuthor: boolean;
  /** Whether logs for this category can be tagged with people. */
  hasPeople: boolean;
  /** Whether the log date field is a full date picker or a year-only input. */
  dateGranularity: DateGranularity;
  /** Label to show for the log date field (e.g. "Date Watched", "Year Read"). */
  dateLabel: string;
}

/**
 * Per-category entry/search field configuration. Single source of truth for which
 * fields the add-entry form and search filters should show for each loggable category.
 */
export const CATEGORY_FIELDS: Record<LoggableCategory, CategoryFieldsConfig> = {
  movie: {
    hasReleaseYear: true,
    hasAuthor: false,
    hasPeople: true,
    dateGranularity: "day",
    dateLabel: "Date Watched",
  },
  tv: {
    hasReleaseYear: false,
    hasAuthor: false,
    hasPeople: false,
    dateGranularity: "year",
    dateLabel: "Year Watched",
  },
  book: {
    hasReleaseYear: false,
    hasAuthor: true,
    hasPeople: false,
    dateGranularity: "year",
    dateLabel: "Year Read",
  },
  eating_out: {
    hasReleaseYear: false,
    hasAuthor: false,
    hasPeople: true,
    dateGranularity: "day",
    dateLabel: "Date Went",
  },
  game: {
    hasReleaseYear: true,
    hasAuthor: false,
    hasPeople: false,
    dateGranularity: "year",
    dateLabel: "Year Played",
  },
};

/**
 * Whether logs for a category can have photo attachments. Currently tied to
 * people-tagging support (Movie, Eating Out) — the "event"-shaped categories.
 * A non-loggable category (e.g. "person") never supports photos.
 */
export function categorySupportsPhotos(category: Category): boolean {
  return isLoggableCategory(category) && CATEGORY_FIELDS[category].hasPeople;
}
