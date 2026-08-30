import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { CATEGORY_META } from "@logger/shared";
import type { CalendarItem } from "@logger/shared";
import { useCalendarMonth } from "../api/hooks.js";
import { addMonths, dayLabel, daysInMonth, monthGrid, monthLabel, WEEKDAYS } from "../lib/calendar.js";

const CATEGORY_DOT: Record<CalendarItem["category"], string> = {
  eating_out: "bg-amber-500",
  hang_out: "bg-violet-500",
  appointment: "bg-sky-500",
  important_date: "bg-rose-500",
};

/** The log types the calendar shows — the "add for this day" shortcut offers these. Mirrors
 *  CALENDAR_LOG_CATEGORIES in server/src/services/calendarService.ts. */
const CALENDAR_ADD_CATEGORIES = ["appointment", "hang_out", "eating_out"] as const;

/** A real YYYY-MM-DD, or null. */
function validDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? s : null;
}

/** Add form for `cat`, date pre-filled, returning to this same calendar day on save. */
function addHref(cat: string, d: string): string {
  return `/add/${cat}?date=${d}&returnTo=${encodeURIComponent(`/calendar?date=${d}`)}`;
}

function categoryLabel(category: CalendarItem["category"]): string {
  return category === "important_date" ? "Important date" : CATEGORY_META[category].label;
}

function itemHref(item: CalendarItem): string {
  if (item.kind === "log") return `/entity/${item.entityId}`;
  return item.entityCategory === "person" ? `/person/${item.entityId}` : `/entity/${item.entityId}`;
}

export function Calendar({
  initialMonth,
  today,
}: { initialMonth?: string; today?: string } = {}) {
  const [params] = useSearchParams();
  const focusDate = validDate(params.get("date"));

  const todayISO = today ?? new Date().toISOString().slice(0, 10);
  const startMonth = initialMonth ?? focusDate?.slice(0, 7) ?? todayISO.slice(0, 7);
  const [month, setMonth] = useState(startMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    focusDate ?? (todayISO.slice(0, 7) === startMonth ? todayISO : null),
  );
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => setAddOpen(false), [selectedDate]);

  const grid = useMemo(() => monthGrid(month), [month]);
  const { data, isLoading } = useCalendarMonth(month);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of data?.items ?? []) {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [data]);

  function goToMonth(nextMonth: string) {
    setMonth(nextMonth);
    setSelectedDate(todayISO.slice(0, 7) === nextMonth ? todayISO : null);
  }

  function selectDay(cellDate: string, inMonth: boolean) {
    if (!inMonth) setMonth(cellDate.slice(0, 7));
    setSelectedDate(cellDate);
  }

  const selectedItems = selectedDate ? (itemsByDate.get(selectedDate) ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <button
          type="button"
          onClick={() => goToMonth(todayISO.slice(0, 7))}
          className="min-h-[36px] rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Today
        </button>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => goToMonth(addMonths(month, -1))}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-lg font-medium">{monthLabel(month)}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => goToMonth(addMonths(month, 1))}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1" aria-busy={isLoading}>
        {grid.map((cell) => {
          const items = itemsByDate.get(cell.date) ?? [];
          const isToday = cell.date === todayISO;
          const isSelected = cell.date === selectedDate;
          const dayNum = Number(cell.date.slice(8, 10));
          return (
            <button
              key={cell.date}
              type="button"
              data-date={cell.date}
              onClick={() => selectDay(cell.date, cell.inMonth)}
              aria-label={dayLabel(cell.date)}
              aria-pressed={isSelected}
              className={`flex min-h-[52px] flex-col items-center gap-1 rounded-md border p-1 text-sm ${
                isSelected
                  ? "border-slate-900 bg-slate-900 text-white dark:border-slate-400 dark:bg-slate-700"
                  : isToday
                    ? "border-slate-400 dark:border-slate-500"
                    : "border-slate-200 dark:border-slate-700"
              } ${cell.inMonth ? "" : "text-slate-400 dark:text-slate-600"} hover:border-slate-400 dark:hover:border-slate-500`}
            >
              <span>{dayNum}</span>
              {cell.inMonth && items.length > 0 && (
                <span className="flex flex-wrap items-center justify-center gap-0.5">
                  {items.slice(0, 3).map((item, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[item.category]}`}
                    />
                  ))}
                  {items.length > 3 && (
                    <span className="text-[10px] leading-none text-slate-500 dark:text-slate-400">
                      +{items.length - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {dayLabel(selectedDate)}
            </h2>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              aria-expanded={addOpen}
              className="flex min-h-[36px] items-center gap-1 rounded-md border border-slate-300 px-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus size={16} />
              Add event
            </button>
          </div>
          {addOpen && (
            <div className="flex flex-wrap gap-2">
              {CALENDAR_ADD_CATEGORIES.map((cat) => (
                <Link
                  key={cat}
                  to={addHref(cat, selectedDate)}
                  className="min-h-[36px] rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {CATEGORY_META[cat].label}
                </Link>
              ))}
            </div>
          )}
          {selectedItems.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing on this day.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selectedItems.map((item) => (
                <li key={`${item.kind}-${item.logId ?? item.noteId}`}>
                  <Link
                    to={itemHref(item)}
                    className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[item.category]}`}
                      />
                      <span className="font-medium dark:text-white">{item.title}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {item.tag ? `${item.tag} · ` : ""}
                        {categoryLabel(item.category)}
                      </span>
                    </span>
                    {item.notes && (
                      <span className="line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                        {item.notes}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
