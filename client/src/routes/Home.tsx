import { Link } from "react-router-dom";
import {
  PlusCircle,
  Search,
  Images,
  GalleryVerticalEnd,
  CalendarDays,
  CalendarHeart,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_META, categoryHasRating } from "@logger/shared";
import type { ImportantDateEntry, UpcomingEventEntry } from "@logger/shared";
import { useSearch, useUpcomingImportantDates, useUpcomingEvents } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";
import { formatLogDate } from "../lib/formatLogDate.js";

function ActionTile({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
    >
      <Icon size={40} strokeWidth={1.5} />
      <span className="font-medium">{label}</span>
    </Link>
  );
}

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
    <div className="w-full max-w-md">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <CalendarHeart size={16} />
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key}>
            <Link
              to={row.to}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
            >
              <span className="flex flex-col">
                <span className="font-medium">{row.primary}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{row.secondary}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Home() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const { data, isLoading } = useSearch({
    groupBy: "log",
    sortBy: "date",
    sortOrder: "desc",
    dateTo: todayISO,
  });
  const recentLogs = (data?.groupBy === "log" ? data.logs : [])?.slice(0, 5) ?? [];
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
    <div className="flex flex-col items-center gap-10 pt-10">
      <h1 className="text-2xl font-semibold">What would you like to do?</h1>
      <div className="grid w-full max-w-md grid-cols-2 gap-4 sm:grid-cols-3">
        <ActionTile to="/add" icon={PlusCircle} label="Add" />
        <ActionTile to="/search" icon={Search} label="Search" />
        <ActionTile to="/calendar" icon={CalendarDays} label="Calendar" />
        <ActionTile to="/gallery" icon={Images} label="Gallery" />
        <ActionTile to="/albums" icon={GalleryVerticalEnd} label="Albums" />
      </div>

      {todayRows.length > 0 && <UpcomingWidget title="Today" rows={todayRows} />}

      {next7Rows.length > 0 && <UpcomingWidget title="Next 7 days" rows={next7Rows} />}

      {!isLoading && recentLogs.length > 0 && (
        <div className="w-full max-w-md">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Recent activity
          </h2>
          <ul className="flex flex-col gap-2">
            {recentLogs.map((log) => (
              <li key={log.id}>
                <Link
                  to={`/entity/${log.entity.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{log.entity.title}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {CATEGORY_META[log.entity.category].label} ·{" "}
                      {formatLogDate(log.date, log.entity.category)}
                    </span>
                  </span>
                  {categoryHasRating(log.entity.category) && (
                    <StarRating value={log.rating} readOnly />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
