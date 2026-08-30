import { useState } from "react";
import type { LogWithEntityDTO } from "@logger/shared";
import { CATEGORY_META } from "@logger/shared";
import { useSearch } from "../api/hooks.js";
import { useDebouncedValue } from "../lib/useDebouncedValue.js";

/**
 * Search existing logs ("events") by keyword and pick one. Reuses the keyword search in flat-log
 * mode — nothing renders until a query is typed (an empty query returns every log).
 */
export function LogPicker({
  onPick,
  excludeIds,
}: {
  onPick: (log: LogWithEntityDTO) => void;
  excludeIds: number[];
}) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const hasQuery = debouncedQ.trim().length > 0;
  const { data, isFetching } = useSearch(
    { q: debouncedQ || undefined, groupBy: "log", sortBy: "date", sortOrder: "desc" },
    { enabled: hasQuery },
  );

  const results =
    hasQuery && data?.groupBy === "log"
      ? (data.logs ?? []).filter((l) => !excludeIds.includes(l.id))
      : [];

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find an event to add…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
      />
      {hasQuery && (
        <ul className="flex flex-col gap-1">
          {results.length === 0 && (
            <li className="px-1 text-sm text-slate-500 dark:text-slate-400">
              {isFetching ? "Searching…" : "No matching events."}
            </li>
          )}
          {results.map((log) => (
            <li key={log.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(log);
                  setQ("");
                }}
                className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <span className="font-medium dark:text-white">{log.entity.title}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {CATEGORY_META[log.entity.category].label} · {log.date}
                  {log.people.length > 0 && ` · with ${log.people.map((p) => p.name).join(", ")}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
