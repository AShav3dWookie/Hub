import { Link } from "react-router-dom";
import { PlusCircle, Search } from "lucide-react";
import { CATEGORY_META } from "@logger/shared";
import { useSearch } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";

export function Home() {
  const { data, isLoading } = useSearch({ groupBy: "log", sortBy: "date", sortOrder: "desc" });
  const recentLogs = (data?.groupBy === "log" ? data.logs : [])?.slice(0, 5) ?? [];

  return (
    <div className="flex flex-col items-center gap-10 pt-10">
      <h1 className="text-2xl font-semibold">What would you like to do?</h1>
      <div className="flex gap-6">
        <Link
          to="/add"
          className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-10 py-8 shadow-sm hover:border-slate-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
        >
          <PlusCircle size={40} strokeWidth={1.5} />
          <span className="font-medium">Add</span>
        </Link>
        <Link
          to="/search"
          className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-10 py-8 shadow-sm hover:border-slate-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
        >
          <Search size={40} strokeWidth={1.5} />
          <span className="font-medium">Search</span>
        </Link>
      </div>

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
