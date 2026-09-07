import { useState } from "react";
import { FIELD_CLASS } from "./ui.js";
import { updateDateRange } from "../lib/updateDateRange.js";

/** A range input's caption, above it rather than inline beside it — "From [____]" beside a
 *  date input leaves the input too narrow to show a date on a phone. */
const RANGE_LABEL_CLASS = "flex flex-col gap-1 text-sm";

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
          <div className="flex shrink-0 overflow-hidden rounded-md border border-slate-300 text-xs dark:border-slate-600">
            <button
              type="button"
              onClick={() => handleModeChange("specific")}
              className={`flex min-h-[44px] items-center px-3 ${
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
              className={`flex min-h-[44px] items-center px-3 ${
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
        <div className="grid grid-cols-2 gap-2">
          <label className={RANGE_LABEL_CLASS}>
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleSpecificChange("start", e.target.value)}
              className={`w-full ${FIELD_CLASS}`}
            />
          </label>
          <label className={RANGE_LABEL_CLASS}>
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleSpecificChange("end", e.target.value)}
              className={`w-full ${FIELD_CLASS}`}
            />
          </label>
        </div>
      )}

      {mode === "year" && (
        <div className="grid grid-cols-2 gap-2">
          <label className={RANGE_LABEL_CLASS}>
            Year
            <input
              type="number"
              inputMode="numeric"
              placeholder="e.g. 2023"
              value={year}
              onChange={(e) => handleYearChange(e.target.value, yearTo)}
              className={`w-full ${FIELD_CLASS}`}
            />
          </label>
          <label className={RANGE_LABEL_CLASS}>
            to
            <input
              type="number"
              inputMode="numeric"
              placeholder="optional end year"
              value={yearTo}
              onChange={(e) => handleYearChange(year, e.target.value)}
              className={`w-full ${FIELD_CLASS}`}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}
