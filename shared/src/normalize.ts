/**
 * Normalize a title/name for case- and whitespace-insensitive dedupe matching.
 * e.g. "  Chipotle " and "chipotle" both normalize to "chipotle".
 *
 * Shared so the offline client dedupes exactly as the server does.
 */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}
