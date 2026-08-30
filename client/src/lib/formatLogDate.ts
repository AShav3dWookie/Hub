import { CATEGORY_FIELDS, isLoggableCategory, type Category } from "@logger/shared";

/**
 * Display string for a log's `date`. Year-granularity categories (TV, Book, Game) store
 * their date as `YYYY-01-01`; show only the year. Everything else shows the stored
 * `YYYY-MM-DD` unchanged.
 */
export function formatLogDate(date: string, category: Category): string {
  if (isLoggableCategory(category) && CATEGORY_FIELDS[category].dateGranularity === "year") {
    return date.slice(0, 4);
  }
  return date;
}
