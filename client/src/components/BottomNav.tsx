import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Home } from "lucide-react";

export function BottomNav() {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();

  // Nothing to go back to and nowhere to "go home" from — hide the bar on the home screen.
  if (pathname === "/") return null;

  function goBack() {
    // `key === "default"` means this is the initial history entry (e.g. a fresh deep link),
    // so there's nothing to pop — send them home instead.
    if (key === "default") {
      navigate("/");
    } else {
      navigate(-1);
    }
  }

  const itemClass =
    "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-6 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200";

  return (
    <nav
      aria-label="Navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <button type="button" onClick={goBack} className={itemClass}>
          <ChevronLeft size={22} strokeWidth={1.75} />
          Back
        </button>
        <NavLink to="/" end className={itemClass}>
          <Home size={22} strokeWidth={1.75} />
          Home
        </NavLink>
      </div>
    </nav>
  );
}
