import { NavLink } from "react-router-dom";
import { Home, PlusCircle, Search } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Home", Icon: Home, end: true },
  { to: "/add", label: "Add", Icon: PlusCircle, end: false },
  { to: "/search", label: "Search", Icon: Search, end: false },
];

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
    >
      <div className="mx-auto flex max-w-3xl">
        {ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                isActive
                  ? "text-slate-900 dark:text-white"
                  : "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              }`
            }
          >
            <Icon size={22} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
