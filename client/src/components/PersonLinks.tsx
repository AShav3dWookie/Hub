import { Link } from "react-router-dom";
import type { PersonRef } from "@logger/shared";

/**
 * The "with Ada, Zoe" line under a log, where each name links to that person's profile.
 *
 * Rendered on the entity page, the album page and both search result shapes. Those four had
 * identical copies of this markup, differing only in the text size class around them.
 */
export function PersonLinks({
  people,
  className = "text-sm text-slate-500 dark:text-slate-400",
}: {
  people: readonly PersonRef[];
  /** Overrides the wrapper classes; search results use a smaller size. */
  className?: string;
}) {
  if (people.length === 0) return null;

  return (
    <p className={className}>
      with{" "}
      {people.map((person, i) => (
        <span key={person.id}>
          <Link to={`/person/${person.id}`} className="hover:underline">
            {person.name}
          </Link>
          {i < people.length - 1 ? ", " : ""}
        </span>
      ))}
    </p>
  );
}
