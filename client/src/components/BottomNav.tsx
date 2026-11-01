import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MORE_TABS, TABS, type Tab } from "../lib/tabs.js";

/** NavLink takes a function so `isActive` actually renders — it used to be passed a plain string. */
const itemClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[var(--nav-h)] flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium transition-colors ${
    isActive
      ? "text-slate-900 dark:text-white"
      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
  }`;

/** How far a finger has to travel up (or down) the bar before it counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 24;

const MORE_ROW_ID = "nav-more-tabs";

function TabRow({ tabs, id }: { tabs: Tab[]; id?: string }) {
  // Five columns whatever the count, so the second row's items line up under the first's.
  return (
    <div id={id} className="mx-auto grid h-[var(--nav-h)] max-w-3xl grid-cols-5 items-stretch gap-1 px-2">
      {tabs.map(({ to, icon: Icon, label, end }) => (
        <NavLink key={to} to={to} end={end} className={itemClass}>
          <Icon size={24} strokeWidth={1.75} aria-hidden />
          {label}
        </NavLink>
      ))}
    </div>
  );
}

const isUnder = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * The five-tab bar, plus a second row that swiping the bar up reveals.
 *
 * The second row overlays the page rather than growing `--nav-h`, so nothing on screen moves
 * when it opens. A pull-handle on top of the bar opens it with a tap too — swiping alone is
 * undiscoverable, can't be done from a keyboard, and Playwright can't easily do it either.
 * It closes on a swipe down, a tap outside, Escape, or going anywhere.
 */
export function BottomNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Any navigation closes the row — including picking one of its own tabs.
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A swipe that starts on a tab ends in a click on it; this swallows that click.
  const swallowNextClick = useRef(false);

  function handlePointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const startY = e.clientY;
    swallowNextClick.current = false;

    // Followed on window, not the bar: an upward swipe leaves the bar almost at once.
    // Capturing the pointer instead would retarget the click, and the tabs would stop working.
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (dy <= -SWIPE_THRESHOLD_PX || dy >= SWIPE_THRESHOLD_PX) {
        setOpen(dy < 0);
        swallowNextClick.current = true;
        stop();
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function handleClickCapture(e: ReactMouseEvent) {
    if (!swallowNextClick.current) return;
    swallowNextClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  // With the row closed you'd otherwise have no sign you're on one of its screens.
  const onHiddenTab = !open && MORE_TABS.some((t) => isUnder(pathname, t.to));

  return (
    <>
      {open && (
        <div
          aria-hidden
          data-testid="nav-more-backdrop"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/10 dark:bg-black/30"
        />
      )}
      <nav
        aria-label="Navigation"
        onPointerDown={handlePointerDown}
        onClickCapture={handleClickCapture}
        // touch-none: without it a swipe up the bar also scrolls the page beneath it (by ~70px
        // in e2e/bottom-nav.spec.ts). The bar itself scrolls nothing, so it gives up nothing.
        // pb-[env(...)] keeps the labels out of the home-indicator gesture zone; the app sets
        // viewport-fit=cover and runs standalone, so nothing else would.
        className="fixed inset-x-0 bottom-0 z-40 touch-none border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
      >
        <button
          type="button"
          aria-label="More tabs"
          aria-expanded={open}
          aria-controls={MORE_ROW_ID}
          onClick={() => setOpen((o) => !o)}
          // 44px tall: --nav-handle-h above the bar plus 6px of its empty top padding. A tab's
          // icon and label are 46px centred in 60, so they start 7px down and never reach it.
          className="absolute left-1/2 top-[calc(-1*var(--nav-handle-h))] z-10 flex h-11 w-20 -translate-x-1/2 items-end justify-center pb-1.5"
        >
          <span className="relative flex h-5 w-14 items-center justify-center rounded-t-lg border border-b-0 border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95">
            <span
              className={`h-1 w-7 rounded-full ${
                onHiddenTab ? "bg-slate-900 dark:bg-white" : "bg-slate-300 dark:bg-slate-600"
              }`}
            />
            {onHiddenTab && (
              <span
                data-testid="nav-more-active"
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-slate-900 dark:bg-white"
              />
            )}
          </span>
        </button>
        {open && (
          <div className="border-b border-slate-200 dark:border-slate-700">
            <TabRow tabs={MORE_TABS} id={MORE_ROW_ID} />
          </div>
        )}
        <TabRow tabs={TABS} />
      </nav>
    </>
  );
}
