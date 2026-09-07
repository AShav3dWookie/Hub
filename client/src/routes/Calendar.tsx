import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { CATEGORY_META } from "@logger/shared";
import type { CalendarItem } from "@logger/shared";
import { useCalendarMonth } from "../api/hooks.js";
import {
  CHIP_CLASS,
  CHIP_OFF_CLASS,
  ICON_BUTTON_CLASS,
  SECONDARY_BUTTON_SM_CLASS,
  SECTION_HEADING,
} from "../components/ui.js";
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

  // Six rows always. A 4- or 5-row month padded to six keeps the grid one size, so paging
  // through the year stops shunting the day panel up and down.
  const grid = useMemo(() => monthGrid(month, 6), [month]);
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
    // A two-pane screen rather than one long scroll: the grid fills its share of the space
    // between the header and the tab bar and never scrolls, and the day panel scrolls inside
    // itself. min-h keeps it honest on a short viewport (landscape), where the page scrolls.
    <div className="flex h-[var(--content-h)] min-h-[30rem] flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => goToMonth(addMonths(month, -1))}
          className={ICON_BUTTON_CLASS}
        >
          <ChevronLeft size={22} aria-hidden />
        </button>
        {/* The month is the page title; a separate "Calendar" heading above it cost a whole bar. */}
        <h1 className="min-w-0 flex-1 truncate text-center text-xl font-semibold">{monthLabel(month)}</h1>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => goToMonth(addMonths(month, 1))}
          className={ICON_BUTTON_CLASS}
        >
          <ChevronRight size={22} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => goToMonth(todayISO.slice(0, 7))}
          className={SECONDARY_BUTTON_SM_CLASS}
        >
          Today
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div
        data-calendar-grid
        className="grid min-h-0 flex-[3] grid-cols-7 grid-rows-6 gap-1"
        aria-busy={isLoading}
      >
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
              className={`flex h-full w-full flex-col items-center gap-1 overflow-hidden rounded-lg border pt-1.5 text-sm tabular-nums ${
                isSelected
                  ? "border-slate-900 bg-slate-900 font-semibold text-white dark:border-slate-400 dark:bg-slate-700"
                  : isToday
                    ? // A ring, not a filled pill behind the number: a second rounded-full span
                      // inside a cell is indistinguishable from an event dot.
                      "border-slate-400 ring-1 ring-inset ring-slate-400 dark:border-slate-500 dark:ring-slate-500"
                    : "border-slate-200 dark:border-slate-700"
              } ${cell.inMonth ? "" : "opacity-40"} hover:border-slate-400 dark:hover:border-slate-500`}
            >
              <span>{dayNum}</span>
              {cell.inMonth && items.length > 0 && (
                <span className="flex flex-wrap items-center justify-center gap-1">
                  {items.slice(0, 3).map((item, i) => (
                    <span
                      key={i}
                      className={`h-2 w-2 rounded-full ${CATEGORY_DOT[item.category]}`}
                    />
                  ))}
                  {items.length > 3 && (
                    <span className="text-2xs leading-none text-slate-500 dark:text-slate-400">
                      +{items.length - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Always rendered, even with nothing selected: letting the panel disappear handed the
          grid the whole screen on a month without today in it, so the cells changed size as
          you paged through the year. */}
      <div className="flex min-h-0 flex-[2] flex-col gap-2">
        {!selectedDate && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pick a day to see what&apos;s on it.
          </p>
        )}
        {selectedDate && (
          <>
          <div className="flex shrink-0 items-center justify-between gap-2">
            <h2 className={`min-w-0 truncate normal-case tracking-normal ${SECTION_HEADING}`}>
              {dayLabel(selectedDate)}
            </h2>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              aria-expanded={addOpen}
              className={`flex shrink-0 items-center gap-1 ${SECONDARY_BUTTON_SM_CLASS}`}
            >
              <Plus size={18} aria-hidden />
              Add event
            </button>
          </div>
          {addOpen && (
            <div className="grid shrink-0 grid-cols-3 gap-2">
              {CALENDAR_ADD_CATEGORIES.map((cat) => (
                <Link
                  key={cat}
                  to={addHref(cat, selectedDate)}
                  className={`${CHIP_CLASS} ${CHIP_OFF_CLASS}`}
                >
                  {CATEGORY_META[cat].label}
                </Link>
              ))}
            </div>
          )}
          {selectedItems.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing on this day.</p>
          ) : (
            // The one scrolling region on the screen.
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
              {selectedItems.map((item) => (
                <li key={`${item.kind}-${item.logId ?? item.noteId}`}>
                  <Link
                    to={itemHref(item)}
                    className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${CATEGORY_DOT[item.category]}`}
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
          </>
        )}
      </div>
    </div>
  );
}
