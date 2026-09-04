import { Link } from "react-router-dom";
import type {
  AlbumSearchResult,
  EntityWithLogsDTO,
  LogWithEntityDTO,
  PersonSearchResult,
} from "@logger/shared";
import { CATEGORY_META, categoryHasRating } from "@logger/shared";
import { StarRating } from "./StarRating.js";
import { PersonLinks } from "./PersonLinks.js";
import { CARD_CLASS } from "./ui.js";
import { formatLogDate } from "../lib/formatLogDate.js";
import { highlightMatches } from "../lib/highlight.js";

/**
 * The four shapes a search result can take. They were written inline in one 440-line component
 * alongside the filter bar; each is self-contained and driven only by its rows and the keyword
 * tokens used for highlighting.
 */

const SECTION_HEADING =
  "text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

const ROW_LINK = `flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 ${CARD_CLASS}`;

export function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`animate-pulse ${CARD_CLASS}`}>
          <div className="flex items-center justify-between">
            <div className="h-5 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="mt-3 h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

/** A named list of links with a count on the right — albums and people share this shape. */
function LinkedList({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className={SECTION_HEADING}>{heading}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function AlbumResults({
  albums,
  tokens,
}: {
  albums: AlbumSearchResult[];
  tokens: readonly string[];
}) {
  if (albums.length === 0) return null;

  return (
    <LinkedList heading="Albums">
      {albums.map((album) => (
        <Link key={album.id} to={`/album/${album.id}`} className={ROW_LINK}>
          <span className="text-lg font-medium dark:text-white">
            {highlightMatches(album.title, tokens)}
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {album.eventCount} event{album.eventCount === 1 ? "" : "s"}
          </span>
        </Link>
      ))}
    </LinkedList>
  );
}

export function PeopleResults({
  people,
  tokens,
}: {
  people: PersonSearchResult[];
  tokens: readonly string[];
}) {
  if (people.length === 0) return null;

  return (
    <LinkedList heading="People">
      {people.map((person) => (
        <Link key={person.id} to={`/person/${person.id}`} className={ROW_LINK}>
          <span className="text-lg font-medium dark:text-white">
            {highlightMatches(person.name, tokens)}
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {person.appearanceCount} log{person.appearanceCount === 1 ? "" : "s"}
          </span>
        </Link>
      ))}
    </LinkedList>
  );
}

/** Entities with their matching logs nested underneath — the default grouping. */
export function EntityResults({
  entities,
  tokens,
}: {
  entities: EntityWithLogsDTO[];
  tokens: readonly string[];
}) {
  if (entities.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {entities.map((entity) => (
        <div key={entity.id} className={CARD_CLASS}>
          <div className="flex items-center justify-between">
            <Link
              to={`/entity/${entity.id}`}
              className="text-lg font-medium hover:underline dark:text-white"
            >
              {highlightMatches(entity.title, tokens)}
            </Link>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {CATEGORY_META[entity.category].label} · {entity.visitCount} log
              {entity.visitCount === 1 ? "" : "s"}
              {entity.averageRating != null && ` · avg ${entity.averageRating.toFixed(1)}★`}
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {entity.logs.map((log) => (
              <li
                key={log.id}
                className="border-t border-slate-100 pt-2 text-sm dark:border-slate-800"
              >
                <div className="flex items-center justify-between">
                  <span className="dark:text-slate-200">
                    {formatLogDate(log.date, entity.category)}
                  </span>
                  {categoryHasRating(entity.category) && <StarRating value={log.rating} readOnly />}
                </div>
                <PersonLinks people={log.people} className="text-slate-500 dark:text-slate-400" />
                {log.notes && (
                  <p className="mt-1 text-slate-700 dark:text-slate-300">
                    {highlightMatches(log.notes, tokens)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A flat list of logs, each with its entity inlined. */
export function LogResults({
  logs,
  tokens,
}: {
  logs: LogWithEntityDTO[];
  tokens: readonly string[];
}) {
  if (logs.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {logs.map((log) => (
        <div key={log.id} className={CARD_CLASS}>
          <div className="flex items-center justify-between">
            <Link
              to={`/entity/${log.entity.id}`}
              className="font-medium hover:underline dark:text-white"
            >
              {highlightMatches(log.entity.title, tokens)}
            </Link>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {CATEGORY_META[log.entity.category].label} ·{" "}
              {formatLogDate(log.date, log.entity.category)}
            </span>
          </div>
          {categoryHasRating(log.entity.category) && <StarRating value={log.rating} readOnly />}
          <PersonLinks people={log.people} />
          {log.notes && (
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
              {highlightMatches(log.notes, tokens)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
