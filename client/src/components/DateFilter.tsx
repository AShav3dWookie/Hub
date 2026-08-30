import { useState } from "react";
import { updateDateRange } from "../lib/updateDateRange.js";

export type DateMode = "specific" | "year";

interface DateFilterProps {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
  /** When set, locks the control to this mode and hides the specific/year toggle. */
  forceMode?: DateMode;
}

/**
 * Unified date-range search control. Toggles between "Specific dates" (plain
 * From/To pickers) and "Year(s)" (a single year, or a year range) — both modes
 * ultimately just produce `dateFrom`/`dateTo` ISO date strings for the parent,
 * since dates are stored as `YYYY-MM-DD` and compare correctly as plain strings.
 * `forceMode` allows a parent (e.g. category-driven search filters) to lock the
 * granularity and hide the toggle entirely.
 */
export function DateFilter({ dateFrom, dateTo, onChange, forceMode }: DateFilterProps) {
  const [internalMode, setInternalMode] = useState<DateMode>("specific");
  const mode = forceMode ?? internalMode;
  const [year, setYear] = useState("");
  const [yearTo, setYearTo] = useState("");

  function handleModeChange(next: DateMode) {
    setInternalMode(next);
    // Clear whatever the previous mode had derived so stale filters don't linger.
    onChange("", "");
    setYear("");
    setYearTo("");
  }

  function handleSpecificChange(edited: "start" | "end", value: string) {
    const next = updateDateRange(edited, value, { start: dateFrom, end: dateTo });
    onChange(next.start, next.end);
  }

  function handleYearChange(nextYear: string, nextYearTo: string) {
    setYear(nextYear);
    setYearTo(nextYearTo);
    if (!nextYear) {
      onChange("", "");
      return;
    }
    const endYear = nextYearTo || nextYear;
    onChange(`${nextYear}-01-01`, `${endYear}-12-31`);
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-slate-300 p-3 dark:border-slate-600">
      <div className="flex items-center justify-between gap-3">
        <legend className="px-1 text-sm font-medium">Date filter</legend>
        {!forceMode && (
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs dark:border-slate-600">
            <button
              type="button"
              onClick={() => handleModeChange("specific")}
              className={`px-2 py-1 ${
                mode === "specific"
                  ? "bg-slate-900 text-white dark:bg-slate-600"
                  : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              Specific dates
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("year")}
              className={`px-2 py-1 ${
                mode === "year"
                  ? "bg-slate-900 text-white dark:bg-slate-600"
                  : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              Year(s)
            </button>
          </div>
        )}
      </div>

      {mode === "specific" && (
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleSpecificChange("start", e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleSpecificChange("end", e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
        </div>
      )}

      {mode === "year" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Year
            <input
              type="number"
              inputMode="numeric"
              placeholder="e.g. 2023"
              value={year}
              onChange={(e) => handleYearChange(e.target.value, yearTo)}
              className="w-24 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            to
            <input
              type="number"
              inputMode="numeric"
              placeholder="optional end year"
              value={yearTo}
              onChange={(e) => handleYearChange(year, e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}
