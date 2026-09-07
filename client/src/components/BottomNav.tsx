import { NavLink } from "react-router-dom";
import { TABS } from "../lib/tabs.js";

/** NavLink takes a function so `isActive` actually renders — it used to be passed a plain string. */
const itemClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[var(--nav-h)] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium transition-colors ${
    isActive
      ? "text-slate-900 dark:text-white"
      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
  }`;

export function BottomNav() {
  return (
    <nav
      aria-label="Navigation"
      // pb-[env(...)] keeps the labels out of the home-indicator gesture zone; the app sets
      // viewport-fit=cover and runs standalone, so nothing else would.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
    >
      <div className="mx-auto flex h-[var(--nav-h)] max-w-3xl items-stretch justify-around gap-1 px-2">
        {TABS.map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} className={itemClass}>
            <Icon size={24} strokeWidth={1.75} aria-hidden />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
