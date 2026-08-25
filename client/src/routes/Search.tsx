import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import type { Category, GroupBy, MatchMode, SortBy, SortOrder, VisitSortBy } from "@logger/shared";
import { CATEGORIES, CATEGORY_META, tokenizeQuery } from "@logger/shared";
import { useSearch } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";
import { DateFilter } from "../components/DateFilter.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="h-5 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="mt-3 h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
    </div>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap any occurrences of the given keyword tokens in `text` with <mark> highlighting. */
function highlightMatches(text: string, tokens: string[]): ReactNode {
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

export function Search() {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [qMode, setQMode] = useState<MatchMode>("all");
  const [category, setCategory] = useState<Category | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ratingMin, setRatingMin] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("entity");
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [visitSortBy, setVisitSortBy] = useState<VisitSortBy>("date");
  const [visitSortOrder, setVisitSortOrder] = useState<SortOrder>("desc");
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, isFetching } = useSearch({
    q: debouncedQ || undefined,
    qMode,
    category: (category as Category) || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    ratingMin: ratingMin ? Number(ratingMin) : undefined,
    groupBy,
    sortBy,
    sortOrder,
    visitSortBy,
    visitSortOrder,
  });

  const queryTokens = tokenizeQuery(q);
  const activeFilterCount = useMemo(
    () => [category, ratingMin, dateFrom, dateTo].filter((v) => v !== "").length,
    [category, ratingMin, dateFrom, dateTo],
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Search</h1>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Keyword… (matches title, notes, and people)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-w-[16rem] flex-1 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Match:
            <select
              value={qMode}
              onChange={(e) => setQMode(e.target.value as MatchMode)}
              className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="all">All words</option>
              <option value="any">Any word</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="flex min-h-[44px] items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SlidersHorizontal size={16} />
            Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>
        </div>

        {showFilters && (
          <>
            <div className="flex flex-wrap gap-3">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category | "")}
                className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>

              <select
                value={ratingMin}
                onChange={(e) => setRatingMin(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Any rating</option>
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {r}+ stars
                  </option>
                ))}
              </select>
            </div>

            <DateFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={(from, to) => {
                setDateFrom(from);
                setDateTo(to);
              }}
            />

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <label className="flex items-center gap-2 text-sm">
                Group:
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                >
                  <option value="entity">By item</option>
                  <option value="log">Flat list</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm">
                Sort:
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                >
                  <option value="date">Date</option>
                  <option value="title">Title</option>
                  <option value="rating">Rating</option>
                  {groupBy === "log" && <option value="person">Person</option>}
                </select>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </label>

              {groupBy === "entity" && (
                <label className="flex items-center gap-2 text-sm">
                  Sort visits by:
                  <select
                    value={visitSortBy}
                    onChange={(e) => setVisitSortBy(e.target.value as VisitSortBy)}
                    className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="date">Date</option>
                    <option value="rating">Rating</option>
                    <option value="person">Person</option>
                  </select>
                  <select
                    value={visitSortOrder}
                    onChange={(e) => setVisitSortOrder(e.target.value as SortOrder)}
                    className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </label>
              )}
            </div>
          </>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {!isLoading && isFetching && <p className="text-sm text-slate-400 dark:text-slate-500">Updating…</p>}

      {!isLoading &&
        data &&
        (data.people?.length ?? 0) === 0 &&
        (data.entities?.length ?? 0) === 0 &&
        (data.logs?.length ?? 0) === 0 && <p className="text-slate-500 dark:text-slate-400">No results.</p>}

      {!isLoading && data?.people && data.people.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            People
          </h2>
          <div className="flex flex-col gap-2">
            {data.people.map((person) => (
              <Link
                key={person.id}
                to={`/person/${person.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                <span className="text-lg font-medium dark:text-white">
                  {highlightMatches(person.name, queryTokens)}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {person.appearanceCount} log{person.appearanceCount === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isLoading && data?.groupBy === "entity" && data.entities && data.entities.length > 0 && (
        <div className="flex flex-col gap-4">
          {data.entities.map((entity) => (
            <div
              key={entity.id}
              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <Link
                  to={`/entity/${entity.id}`}
                  className="text-lg font-medium hover:underline dark:text-white"
                >
                  {highlightMatches(entity.title, queryTokens)}
                </Link>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {CATEGORY_META[entity.category].label} · {entity.visitCount} log
                  {entity.visitCount === 1 ? "" : "s"}
                  {entity.averageRating != null && ` · avg ${entity.averageRating.toFixed(1)}★`}
                </span>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {entity.logs.map((log) => (
                  <li key={log.id} className="border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="dark:text-slate-200">{log.date}</span>
                      <StarRating value={log.rating} readOnly />
                    </div>
                    {log.people.length > 0 && (
                      <p className="text-slate-500 dark:text-slate-400">
                        with{" "}
                        {log.people.map((p, i) => (
                          <span key={p.id}>
                            <Link to={`/person/${p.id}`} className="hover:underline">
                              {p.name}
                            </Link>
                            {i < log.people.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </p>
                    )}
                    {log.notes && (
                      <p className="mt-1 text-slate-700 dark:text-slate-300">
                        {highlightMatches(log.notes, queryTokens)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!isLoading && data?.groupBy === "log" && data.logs && data.logs.length > 0 && (
        <div className="flex flex-col gap-3">
          {data.logs.map((log) => (
            <div
              key={log.id}
              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <Link to={`/entity/${log.entity.id}`} className="font-medium hover:underline dark:text-white">
                  {highlightMatches(log.entity.title, queryTokens)}
                </Link>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {CATEGORY_META[log.entity.category].label} · {log.date}
                </span>
              </div>
              <StarRating value={log.rating} readOnly />
              {log.people.length > 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  with{" "}
                  {log.people.map((p, i) => (
                    <span key={p.id}>
                      <Link to={`/person/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                      {i < log.people.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </p>
              )}
              {log.notes && (
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                  {highlightMatches(log.notes, queryTokens)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
