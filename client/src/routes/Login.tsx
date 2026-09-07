import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CARD_CLASS, FIELD_CLASS, PRIMARY_BUTTON_CLASS } from "../components/ui.js";
import { ApiError } from "../api/client.js";
import { useLogin } from "../api/auth.js";

/** Only same-origin absolute paths are safe redirect targets ("//host" is not). */
function safeDest(from: unknown): string {
  const pathname =
    from && typeof from === "object" && "pathname" in from
      ? (from as { pathname?: unknown }).pathname
      : undefined;
  if (typeof pathname === "string" && pathname.startsWith("/") && !pathname.startsWith("//")) {
    return pathname;
  }
  return "/";
}

export function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const dest = safeDest((location.state as { from?: unknown } | null)?.from);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync(password);
      navigate(dest, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? "Incorrect password." : "Something went wrong. Please try again.");
      } else {
        setError("Can't reach the server. Check your connection and try again.");
      }
    }
  }

  return (
    // Rendered outside Layout, so nothing else pads the notch or the home indicator for it.
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))] dark:text-slate-100">
      <div className={`${CARD_CLASS} w-full max-w-sm`}>
        <h1 className="text-2xl font-semibold">Logger</h1>
        <p className="mt-1 mb-4 text-sm text-slate-500 dark:text-slate-400">
          Enter your password to continue.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            className={`${FIELD_CLASS} w-full`}
          />
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={login.isPending}
            aria-busy={login.isPending}
            className={`${PRIMARY_BUTTON_CLASS} w-full`}
          >
            {login.isPending ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
