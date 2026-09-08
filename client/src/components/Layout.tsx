import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronLeft, Pencil, Settings } from "lucide-react";
import { useLogout, useAuthStatus } from "../api/auth.js";
import { BottomNav } from "./BottomNav.js";
import { TAB_PATHS } from "../lib/tabs.js";
import { ICON_BUTTON_ACTIVE_CLASS, ICON_BUTTON_CLASS } from "./ui.js";
import { useEditModeToggle } from "./EditModeProvider.js";

export function Layout({ children }: { children: ReactNode }) {
  const { data } = useAuthStatus();
  const logout = useLogout();
  const { pathname, key } = useLocation();
  const { editing, supported: editable, toggle: toggleEditing } = useEditModeToggle();
  const navigate = useNavigate();

  // The tab bar owns the five roots, so a back arrow there would be a no-op. Everything
  // deeper is reached from somewhere, and needs a way out that isn't the system gesture.
  const atTabRoot = TAB_PATHS.includes(pathname);

  function goBack() {
    // `key === "default"` means this is the initial history entry (e.g. a fresh deep link),
    // so there's nothing to pop — send them home instead.
    if (key === "default") {
      navigate("/");
    } else {
      navigate(-1);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex h-[var(--header-h)] max-w-3xl items-center gap-1 px-2">
          {!atTabRoot && (
            <button type="button" onClick={goBack} aria-label="Back" className={ICON_BUTTON_CLASS}>
              <ChevronLeft size={24} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          <Link
            to="/"
            className="flex min-h-[44px] min-w-0 flex-1 items-center rounded-md px-1 text-lg font-semibold text-slate-900 transition-colors hover:text-slate-600 dark:text-white dark:hover:text-slate-300"
          >
            Logger
          </Link>
          {/* Only the screens with something to change offer it — see EditModeProvider. */}
          {editable && (
            <button
              type="button"
              onClick={toggleEditing}
              // Not just "Edit": the cards inside these screens have their own Edit buttons.
              aria-label={editing ? "Done editing" : "Edit this screen"}
              aria-pressed={editing}
              className={editing ? `${ICON_BUTTON_CLASS} ${ICON_BUTTON_ACTIVE_CLASS}` : ICON_BUTTON_CLASS}
            >
              {editing ? (
                <Check size={22} strokeWidth={2} aria-hidden />
              ) : (
                <Pencil size={20} strokeWidth={1.75} aria-hidden />
              )}
            </button>
          )}
          <Link to="/settings" aria-label="Settings" className={ICON_BUTTON_CLASS}>
            <Settings size={22} strokeWidth={1.75} aria-hidden />
          </Link>
          {data?.authRequired && data.authenticated && (
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="min-h-[44px] rounded-md px-2 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Log out
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-3 pt-[var(--content-pt)] pb-[var(--content-pb)] dark:text-slate-100">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
