/**
 * Shared keyword-search matching helpers, used by both the search API
 * (server-side filtering) and the client (to highlight matched words in
 * results) so behavior stays consistent between the two.
 */
export type MatchMode = "all" | "any";

/** Normalize + split a free-text query into lowercase whitespace-separated tokens. */
export function tokenizeQuery(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Check whether `haystack` (already lowercased, or not — comparison is
 * case-insensitive) contains the given tokens, per `mode`:
 * - "all" (default): every token must appear somewhere in the haystack.
 * - "any": at least one token must appear.
 */
export function matchesTokens(haystack: string, tokens: string[], mode: MatchMode = "all"): boolean {
  if (tokens.length === 0) return true;
  const lowerHaystack = haystack.toLowerCase();
  return mode === "any"
    ? tokens.some((token) => lowerHaystack.includes(token))
    : tokens.every((token) => lowerHaystack.includes(token));
}
