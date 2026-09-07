import { Link } from "react-router-dom";
import { CalendarHeart, ChevronRight, Images, PlusCircle } from "lucide-react";
import { CATEGORY_META } from "@logger/shared";
import type { ImportantDateEntry, UpcomingEventEntry } from "@logger/shared";
import { useGallery, useUpcomingImportantDates, useUpcomingEvents } from "../api/hooks.js";
import { MediaThumb } from "../components/MediaThumb.js";
import { weekdayShort } from "../lib/calendar.js";
import { CARD_CLASS, SECTION_HEADING } from "../components/ui.js";

/** A flattened upcoming item — an important date or a one-off event — for the home widget. */
interface UpcomingRow {
  key: string;
  to: string;
  primary: string;
  secondary: string;
  /** ISO date used for sorting within a bucket. */
  date: string;
}

function importantDateRow(entry: ImportantDateEntry): UpcomingRow {
  return {
    key: `date-${entry.noteId}`,
    to: `/person/${entry.entityId}`,
    primary: entry.entityName,
    secondary: `${entry.tag} · ${entry.nextOccurrence}`,
    date: entry.nextOccurrence,
  };
}

function eventRow(entry: UpcomingEventEntry): UpcomingRow {
  const withWho = entry.people.length > 0 ? ` · with ${entry.people.map((p) => p.name).join(", ")}` : "";
  return {
    key: `event-${entry.logId}`,
    to: `/entity/${entry.entityId}`,
    primary: entry.entityTitle,
    secondary: `${CATEGORY_META[entry.category].label} · ${entry.date}${withWho}`,
    date: entry.date,
  };
}

function UpcomingWidget({ title, rows }: { title: string; rows: UpcomingRow[] }) {
  return (
    <div>
      <h2 className={`mb-2 flex items-center gap-2 ${SECTION_HEADING}`}>
        <CalendarHeart size={16} aria-hidden />
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key}>
            <Link
              to={row.to}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{row.primary}</span>
                <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {row.secondary}
                </span>
              </span>
              {/* The right half of this row used to be empty: justify-between with one child. */}
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {weekdayShort(row.date)}
                <ChevronRight size={16} aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The four newest photos, linking through to the gallery.
 *
 * Reuses the gallery's own query — it is already newest-first and already cached by the
 * time you reach here — rather than asking the server for a second, nearly identical list.
 */
function RecentPhotos() {
  const { data } = useGallery();
  const photos = (data?.pages[0]?.photos ?? []).slice(0, 4);
  if (photos.length === 0) return null;

  return (
    <div>
      <h2 className={`mb-2 flex items-center gap-2 ${SECTION_HEADING}`}>
        <Images size={16} aria-hidden />
        Recent photos
      </h2>
      <Link to="/gallery" className="grid grid-cols-4 gap-2" aria-label="Recent photos">
        {photos.map((photo) => (
          <span
            key={photo.id}
            className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
          >
            <MediaThumb photo={photo} badgeSize="h-7 w-7" />
          </span>
        ))}
      </Link>
    </div>
  );
}

export function Home() {
  const { data: importantDates } = useUpcomingImportantDates();
  const { data: events } = useUpcomingEvents();

  const byDate = (a: UpcomingRow, b: UpcomingRow) => a.date.localeCompare(b.date);
  const todayRows = [
    ...(importantDates?.today ?? []).map(importantDateRow),
    ...(events?.today ?? []).map(eventRow),
  ].sort(byDate);
  const next7Rows = [
    ...(importantDates?.next7Days ?? []).map(importantDateRow),
    ...(events?.next7Days ?? []).map(eventRow),
  ].sort(byDate);

  return (
    // Content first, and full width. This used to be a centred launcher capped at max-w-md
    // with pt-10 on top of main's padding — 72px of nothing before the first word, and five
    // tiles duplicating destinations the tab bar now owns.
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">What&apos;s on</h1>

      {todayRows.length > 0 && <UpcomingWidget title="Today" rows={todayRows} />}
      {next7Rows.length > 0 && <UpcomingWidget title="Next 7 days" rows={next7Rows} />}

      {todayRows.length === 0 && next7Rows.length === 0 && (
        <div className={`flex flex-col items-start gap-3 ${CARD_CLASS}`}>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nothing coming up in the next week.
          </p>
          <Link
            to="/add"
            className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-900 hover:underline dark:text-white"
          >
            <PlusCircle size={20} aria-hidden />
            Log something
          </Link>
        </div>
      )}

      <RecentPhotos />
    </div>
  );
}
