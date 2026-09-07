import { useMemo, useState } from "react";
import {
  CHIP_CLASS,
  CHIP_MUTED_CLASS,
  CHIP_OFF_CLASS,
  CHIP_ON_CLASS,
  FIELD_CLASS,
} from "../components/ui.js";
import { SlidersHorizontal } from "lucide-react";
import type {
  GroupBy,
  LoggableCategory,
  MatchMode,
  SearchCategory,
  SortBy,
  SortOrder,
  VisitSortBy,
} from "@logger/shared";
import {
  CATEGORIES,
  CATEGORY_META,
  CATEGORY_FIELDS,
  isLoggableCategory,
  tokenizeQuery,
} from "@logger/shared";
import { useSearch } from "../api/hooks.js";
import { DateFilter, type DateMode } from "../components/DateFilter.js";
import {
  AlbumResults,
  EntityResults,
  LogResults,
  PeopleResults,
  SearchSkeleton,
} from "../components/SearchResults.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";



/** A filter control's caption, sitting above it rather than inline beside it. */
const FILTER_LABEL_CLASS = "flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400";

export function Search() {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [qMode, setQMode] = useState<MatchMode>("all");
  const [category, setCategory] = useState<SearchCategory | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ratingMin, setRatingMin] = useState("");
  const [authorContains, setAuthorContains] = useState("");
  const [releaseYearMin, setReleaseYearMin] = useState("");
  const [releaseYearMax, setReleaseYearMax] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("entity");
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [visitSortBy, setVisitSortBy] = useState<VisitSortBy>("date");
  const [visitSortOrder, setVisitSortOrder] = useState<SortOrder>("desc");
  const [showFilters, setShowFilters] = useState(false);

  const isPerson = category === "person";
  const isAlbum = category === "album";
  const nameOnly = isPerson || isAlbum;
  const categoryFields =
    category && category !== "album" && isLoggableCategory(category)
      ? CATEGORY_FIELDS[category as LoggableCategory]
      : null;

  function handleCategoryChange(next: SearchCategory | "") {
    setCategory(next);
    // Category dictates which filters apply; clear ones that don't carry over.
    setDateFrom("");
    setDateTo("");
    setAuthorContains("");
    setReleaseYearMin("");
    setReleaseYearMax("");
  }

  const { data, isLoading, isFetching } = useSearch({
    q: debouncedQ || undefined,
    qMode,
    category: category || undefined,
    dateFrom: !nameOnly ? dateFrom || undefined : undefined,
    dateTo: !nameOnly ? dateTo || undefined : undefined,
    ratingMin: !nameOnly && ratingMin ? Number(ratingMin) : undefined,
    authorContains: categoryFields?.hasAuthor && authorContains ? authorContains : undefined,
    releaseYearMin: categoryFields?.hasReleaseYear && releaseYearMin ? Number(releaseYearMin) : undefined,
    releaseYearMax: categoryFields?.hasReleaseYear && releaseYearMax ? Number(releaseYearMax) : undefined,
    groupBy,
    sortBy,
    sortOrder,
    visitSortBy,
    visitSortOrder,
  });

  const queryTokens = tokenizeQuery(q);
  const activeFilterCount = useMemo(
    () =>
      [category, ratingMin, dateFrom, dateTo, authorContains, releaseYearMin, releaseYearMax].filter(
        (v) => v !== "",
      ).length,
    [category, ratingMin, dateFrom, dateTo, authorContains, releaseYearMin, releaseYearMax],
  );


  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Search</h1>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        {/* The keyword box had a 16rem minimum inside a ~360px column, so this row wrapped
            at every phone width. It takes a row of its own; Match and Filters share the next. */}
        <input
          type="text"
          placeholder="Keyword… (title, notes, people)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`w-full ${FIELD_CLASS}`}
        />
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Match:
            <select
              value={qMode}
              onChange={(e) => setQMode(e.target.value as MatchMode)}
              className={`min-w-0 flex-1 ${FIELD_CLASS}`}
            >
              <option value="all">All words</option>
              <option value="any">Any word</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SlidersHorizontal size={18} aria-hidden />
            Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>
        </div>

        {showFilters && (
          <>
            <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Category">
              <button
                type="button"
                role="tab"
                aria-selected={category === ""}
                onClick={() => handleCategoryChange("")}
                className={`${CHIP_CLASS} ${category === "" ? CHIP_ON_CLASS : CHIP_OFF_CLASS}`}
              >
                All
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={category === c}
                  onClick={() => handleCategoryChange(c)}
                  className={`${CHIP_CLASS} ${
                    category === c ? CHIP_ON_CLASS : c === "person" ? CHIP_MUTED_CLASS : CHIP_OFF_CLASS
                  }`}
                >
                  {CATEGORY_META[c].label}
                </button>
              ))}
              <button
                type="button"
                role="tab"
                aria-selected={isAlbum}
                onClick={() => handleCategoryChange("album")}
                className={`${CHIP_CLASS} ${isAlbum ? CHIP_ON_CLASS : CHIP_MUTED_CLASS}`}
              >
                Album
              </button>
            </div>

            {nameOnly ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Searching {isAlbum ? "albums" : "people"} by {isAlbum ? "title" : "name"} only —
                ratings, dates, and other filters don't apply.
              </p>
            ) : (
              <>
                {/* Two even columns instead of a wrapping row: at 388px the w-40 year pair
                    and a full-width select wrapped into a ragged three-line stack. */}
                <div className="grid grid-cols-2 gap-2">
                  {(!categoryFields || categoryFields.hasRating) && (
                    <select
                      value={ratingMin}
                      onChange={(e) => setRatingMin(e.target.value)}
                      className={`col-span-2 w-full ${FIELD_CLASS}`}
                    >
                      <option value="">Any rating</option>
                      {[1, 2, 3, 4, 5].map((r) => (
                        <option key={r} value={r}>
                          {r}+ stars
                        </option>
                      ))}
                    </select>
                  )}

                  {categoryFields?.hasAuthor && (
                    <input
                      type="text"
                      placeholder="Author contains…"
                      value={authorContains}
                      onChange={(e) => setAuthorContains(e.target.value)}
                      className={`col-span-2 w-full ${FIELD_CLASS}`}
                    />
                  )}

                  {categoryFields?.hasReleaseYear && (
                    <>
                      <input
                        type="number"
                        placeholder="Year from"
                        value={releaseYearMin}
                        onChange={(e) => setReleaseYearMin(e.target.value)}
                        className={`w-full ${FIELD_CLASS}`}
                      />
                      <input
                        type="number"
                        placeholder="Year to"
                        value={releaseYearMax}
                        onChange={(e) => setReleaseYearMax(e.target.value)}
                        className={`w-full ${FIELD_CLASS}`}
                      />
                    </>
                  )}
                </div>

                <DateFilter
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  forceMode={categoryFields ? ((categoryFields.dateGranularity === "year" ? "year" : "specific") as DateMode) : undefined}
                  onChange={(from, to) => {
                    setDateFrom(from);
                    setDateTo(to);
                  }}
                />
              </>
            )}

            {!nameOnly && (
              // Labels above their controls, in an even two-column grid. Inline "Group: [x]"
              // labels are what wrapped this row into four ragged lines on a phone.
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <label className={`col-span-2 ${FILTER_LABEL_CLASS}`}>
                  Group
                  <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                    className={`w-full ${FIELD_CLASS}`}
                  >
                    <option value="entity">By item</option>
                    <option value="log">Flat list</option>
                  </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                  Sort
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    className={`w-full ${FIELD_CLASS}`}
                  >
                    <option value="date">Date</option>
                    <option value="title">Title</option>
                    <option value="rating">Rating</option>
                    {groupBy === "log" && <option value="person">Person</option>}
                  </select>
                </label>
                <label className={FILTER_LABEL_CLASS}>
                  Order
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                    className={`w-full ${FIELD_CLASS}`}
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </label>

                {groupBy === "entity" && (
                  <>
                    <label className={FILTER_LABEL_CLASS}>
                      Sort visits by
                      <select
                        value={visitSortBy}
                        onChange={(e) => setVisitSortBy(e.target.value as VisitSortBy)}
                        className={`w-full ${FIELD_CLASS}`}
                      >
                        <option value="date">Date</option>
                        <option value="rating">Rating</option>
                        <option value="person">Person</option>
                      </select>
                    </label>
                    <label className={FILTER_LABEL_CLASS}>
                      Visit order
                      <select
                        value={visitSortOrder}
                        onChange={(e) => setVisitSortOrder(e.target.value as SortOrder)}
                        className={`w-full ${FIELD_CLASS}`}
                      >
                        <option value="desc">Desc</option>
                        <option value="asc">Asc</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {isLoading && <SearchSkeleton />}
      {!isLoading && isFetching && <p className="text-sm text-slate-400 dark:text-slate-500">Updating…</p>}

      {!isLoading &&
        data &&
        (data.albums?.length ?? 0) === 0 &&
        (data.people?.length ?? 0) === 0 &&
        (data.entities?.length ?? 0) === 0 &&
        (data.logs?.length ?? 0) === 0 && <p className="text-slate-500 dark:text-slate-400">No results.</p>}

      {!isLoading && data && (
        <>
          <AlbumResults albums={data.albums ?? []} tokens={queryTokens} />
          <PeopleResults people={data.people ?? []} tokens={queryTokens} />
          {data.groupBy === "entity" && (
            <EntityResults entities={data.entities ?? []} tokens={queryTokens} />
          )}
          {data.groupBy === "log" && <LogResults logs={data.logs ?? []} tokens={queryTokens} />}
        </>
      )}
    </div>
  );
}
