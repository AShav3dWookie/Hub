import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLogout, useAuthStatus } from "../api/auth.js";
import { BottomNav } from "./BottomNav.js";

export function Layout({ children }: { children: ReactNode }) {
  const { data } = useAuthStatus();
  const logout = useLogout();
  // BottomNav is hidden on the home screen, so it doesn't need the bottom clearance there.
  const onHome = useLocation().pathname === "/";

  return (
    <div className="min-h-full dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link
            to="/"
            className="rounded-md text-lg font-semibold text-slate-900 transition-colors hover:text-slate-600 hover:underline dark:text-white dark:hover:text-slate-300"
          >
            Logger
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
      <main
        className={`mx-auto max-w-3xl px-4 py-8 dark:text-slate-100 ${onHome ? "pb-8" : "pb-24"}`}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
