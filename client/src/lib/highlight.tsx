import type { ReactNode } from "react";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap any occurrence of the given keyword tokens in `text` with `<mark>`, so a search result
 * shows why it matched.
 *
 * Tokens come from the user's query and go into a RegExp, so each is escaped first — a query of
 * "c++" or "(500)" would otherwise throw or match wildly.
 */
export function highlightMatches(text: string, tokens: readonly string[]): ReactNode {
  if (tokens.length === 0) return text;

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);

  return parts.map((part, i) =>
    tokens.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
