import { Link } from "react-router-dom";
import { PlusCircle, Search, Images, CalendarHeart, type LucideIcon } from "lucide-react";
import { CATEGORY_META } from "@logger/shared";
import type { ImportantDateEntry } from "@logger/shared";
import { useSearch, useUpcomingImportantDates } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";

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

function ImportantDatesWidget({ title, entries }: { title: string; entries: ImportantDateEntry[] }) {
  return (
    <div className="w-full max-w-md">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <CalendarHeart size={16} />
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.noteId}>
            <Link
              to={`/person/${entry.entityId}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
            >
              <span className="flex flex-col">
                <span className="font-medium">{entry.entityName}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {entry.tag} · {entry.nextOccurrence}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Home() {
  const { data, isLoading } = useSearch({ groupBy: "log", sortBy: "date", sortOrder: "desc" });
  const recentLogs = (data?.groupBy === "log" ? data.logs : [])?.slice(0, 5) ?? [];
  const { data: importantDates } = useUpcomingImportantDates();

  return (
    <div className="flex flex-col items-center gap-10 pt-10">
      <h1 className="text-2xl font-semibold">What would you like to do?</h1>
      <div className="grid w-full max-w-md grid-cols-2 gap-4 sm:grid-cols-3">
        <ActionTile to="/add" icon={PlusCircle} label="Add" />
        <ActionTile to="/search" icon={Search} label="Search" />
        <ActionTile to="/gallery" icon={Images} label="Gallery" />
      </div>

      {importantDates && importantDates.today.length > 0 && (
        <ImportantDatesWidget title="Today's important dates" entries={importantDates.today} />
      )}

      {importantDates && importantDates.next7Days.length > 0 && (
        <ImportantDatesWidget title="Next 7 days" entries={importantDates.next7Days} />
      )}

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
                      {CATEGORY_META[log.entity.category].label} · {log.date}
                    </span>
                  </span>
                  <StarRating value={log.rating} readOnly />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

