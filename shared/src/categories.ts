/**
 * Hardcoded category list for v1. Movie/TV/Restaurant/Book/Game are "loggable"
 * categories (they support repeated Log entries). Person is special: it has no
 * logs of its own, just an entity record, and is tagged onto other logs.
 */
export const CATEGORIES = [
  "movie",
  "tv",
  "restaurant",
  "book",
  "game",
  "person",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const LOGGABLE_CATEGORIES = [
  "movie",
  "tv",
  "restaurant",
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
  restaurant: { category: "restaurant", label: "Restaurant", icon: "UtensilsCrossed" },
  book: { category: "book", label: "Book", icon: "BookOpen" },
  game: { category: "game", label: "Game", icon: "Gamepad2" },
  person: { category: "person", label: "Person", icon: "User" },
};
